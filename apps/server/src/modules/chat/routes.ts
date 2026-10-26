import { Elysia } from "elysia";
import { z } from "zod";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { AttachmentError, NotReadyError, OnboardingError, TurnBusyError, type ChatEvent, type ChatService } from "./service";
import { decisionConfigSchema } from "./routing";
import { FileAccessError, type FileStore } from "./files";
import { createUIMessageStreamResponse } from "ai";
import { toUIMessageStream } from "./ui-stream";

export type ChatServices = { access: ReturnType<typeof createIdentityAccess>; chat: ChatService; files?: FileStore };

const uuid = z.string().uuid();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const botAvatar = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preset"), preset: z.string().regex(/^[a-z0-9-]{1,32}$/), colors: z.array(hexColor).min(1).max(4) }),
  z.strictObject({ kind: z.literal("image"), src: z.string().max(300_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) }),
]);
const botInput = z.strictObject({
  avatar: botAvatar.nullable().optional(),
  name: z.string().trim().min(1).max(80), description: z.string().max(2048).optional(), visibility: z.enum(["private", "team"]).optional(),
  harness: z.enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor", "fixture"]).optional(), model: z.string().max(128).nullable().optional(),
  personality: z.string().max(4096).optional(), instructions: z.string().max(16384).optional(), computerMode: z.enum(["off", "browser", "desktop"]).optional(), codeAccess: z.boolean().optional(),
  requiredConnections: z.array(z.strictObject({ key: z.string().regex(/^[a-z0-9_-]{1,32}$/), provider: z.enum(["anthropic", "openai", "google", "openrouter", "github"]) })).max(8).optional(),
});
const botPatch = z.strictObject({ expectedVersion: z.number().int().positive(), patch: botInput.partial() });
const onboarding = z.strictObject({ conversationId: uuid, questionId: uuid, expectedVersion: z.number().int().positive(), satisfied: z.boolean() });
const send = z.strictObject({ clientRequestId: z.string().min(8).max(100).optional(), content: z.string().trim().min(1).max(32768), parentMessageId: uuid.optional(), attachmentIds: z.array(uuid).max(5).optional(), fileRefs: z.array(z.string().min(1).max(300)).max(5).optional() });
const upload = z.strictObject({ name: z.string().trim().min(1).max(200), mimeType: z.string().max(100).default("text/plain"), text: z.string().max(262144), conversationId: uuid.optional() });
const noFiles: FileStore = { list: async () => { throw new FileAccessError("NOT_FOUND"); }, read: async () => { throw new FileAccessError("NOT_FOUND"); }, readWithHash: async () => { throw new FileAccessError("NOT_FOUND"); } };
const filePath = z.string().min(1).max(300);
const startChat = z.strictObject({ botId: uuid });

const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createChatRoutes({ access, chat, files }: ChatServices, trustedOrigins: readonly string[]) {
  const guarded = (work: (ctx: { actor: Awaited<ReturnType<typeof access.requireActive>>; body: unknown; params: Record<string, string>; query: Record<string, string | undefined> }) => Promise<unknown>, status = 200) =>
    async ({ request, body, params, query }: { request: Request; body: unknown; params: Record<string, string>; query: Record<string, string | undefined> }) => {
      try {
        if (request.method !== "GET") {
          const origin = request.headers.get("origin");
          if (!origin || !trustedOrigins.includes(origin)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again.");
        }
        const actor = await access.requireActive(request.headers);
        return ok(await work({ actor, body, params, query }), status);
      } catch (error) { return mapError(error); }
    };
  const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => schema.parse(value);

  /** Server-sent events with cursor ids: `id: n` per frame. The turn keeps running if the connection drops; reconnect with
   * GET /conversations/:id/stream?after=n. Authorization/validation errors are plain JSON before any event. */
  function sse(follow: AsyncGenerator<{ n: number; event: unknown }>, onClose: () => void) {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      async start(controller) {
        try { for await (const { n, event } of follow) controller.enqueue(encoder.encode(`id: ${n}\ndata: ${JSON.stringify(event)}\n\n`)); }
        catch { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error" })}\n\n`)); } catch { /* closed */ } }
        try { controller.close(); } catch { /* closed */ }
      },
      cancel() { onClose(); }, // dropping the connection never cancels the turn
    }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }
  async function streamReply({ request, body, params }: { request: Request; body: unknown; params: Record<string, string> }) {
    try {
      const origin = request.headers.get("origin");
      if (!origin || !trustedOrigins.includes(origin)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again.");
      const actor = await access.requireActive(request.headers);
      const turn = await chat.startTurn(actor, parse(uuid, params.id), parse(send, body));
      return sse(turn.follow(0), () => {});
    } catch (error) { return mapError(error); }
  }
  async function resumeReply({ request, params, query }: { request: Request; params: Record<string, string>; query: Record<string, string | undefined> }) {
    try {
      const actor = await access.requireActive(request.headers);
      const after = z.coerce.number().int().min(0).default(0).parse(query.after ?? 0);
      const turn = await chat.resumeTurn(actor, parse(uuid, params.id), after);
      if (!turn) return ok({ resumable: false });
      return sse(turn.follow(), () => {});
    } catch (error) { return mapError(error); }
  }
  /** AI SDK UI message stream of a turn, always from its first event; a failed turn ends with an `error` chunk. */
  function uiStream(turn: { rec: { error?: unknown }; follow: () => AsyncGenerator<{ event: ChatEvent }> }) {
    const events = async function* () { for await (const { event } of turn.follow()) yield event; if (turn.rec.error) throw turn.rec.error; };
    return createUIMessageStreamResponse({ stream: toUIMessageStream(events()), headers: { "cache-control": "no-store", "x-accel-buffering": "no" } });
  }
  async function chatReply({ request, body, params }: { request: Request; body: unknown; params: Record<string, string> }) {
    try {
      const origin = request.headers.get("origin");
      if (!origin || !trustedOrigins.includes(origin)) return fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again.");
      const actor = await access.requireActive(request.headers);
      const turn = await chat.startTurn(actor, parse(uuid, params.id), parse(send, body));
      return uiStream({ rec: turn.rec, follow: () => turn.follow(0) });
    } catch (error) { return mapError(error); }
  }
  async function resumeChat({ request, params }: { request: Request; params: Record<string, string> }) {
    try {
      const actor = await access.requireActive(request.headers);
      const turn = await chat.resumeTurn(actor, parse(uuid, params.id), 0);
      if (!turn || turn.rec.done) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return uiStream(turn);
    } catch (error) { return mapError(error); }
  }
  function mapError(error: unknown) {
    if (error instanceof AccessError) return fail(error.code === "SIGN_IN_REQUIRED" ? 401 : error.code === "NOT_FOUND" ? 404 : error.code === "IDENTITY_UNAVAILABLE" ? 503 : 403, error.code, error.message);
    if (error instanceof NotReadyError) return fail(409, "BOT_NOT_READY", "This bot is not ready yet. Its owner has to finish setting it up first.");
    if (error instanceof TurnBusyError) return fail(409, "TURN_BUSY", "This chat is still answering. Wait for it to finish or cancel it.");
    if (error instanceof OnboardingError) return fail(409, error.code, error.code === "FIXTURE_NOT_EVIDENCE" ? "Choose a real harness for this bot first; the offline fixture cannot confirm readiness." : "Chat with the bot first, then say whether you are satisfied.");
    if (error instanceof AttachmentError) return fail(400, "ATTACHMENT_INVALID", "Only text files up to 256 KB can be attached.");
    if (error instanceof FileAccessError) return fail(error.code === "NOT_FOUND" ? 404 : 400, error.code, "That file is not available.");
    if (error instanceof z.ZodError) return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "CHAT_UNAVAILABLE", "Something went wrong. Please retry.");
  }

  return new Elysia({ prefix: "/api", normalize: false })
    .post("/conversations/:id/stream", streamReply)
    .get("/conversations/:id/stream", resumeReply)
    .post("/conversations/:id/chat", chatReply)
    .get("/conversations/:id/chat/stream", resumeChat)
    .post("/conversations/:id/cancel", guarded(async ({ actor, params }) => ({ cancelled: await chat.cancelTurn(actor, parse(uuid, params.id)) })))
    .post("/attachments", guarded(async ({ actor, body }) => ({ attachment: await chat.addAttachment(actor, parse(upload, body)) }), 201))
    .get("/files", guarded(async ({ actor, query }) => ({ entries: await (files ?? noFiles).list(actor.userId, parse(filePath, query.path ?? "shared")) })))
    .get("/files/content", guarded(async ({ actor, query }) => ({ text: await (files ?? noFiles).read(actor.userId, parse(filePath, query.path)) })))
    .get("/bots", guarded(async ({ actor }) => { await chat.ensureChief(actor); return { bots: await chat.listBots(actor).then((rows) => rows.map((b) => ({ ...b, canEdit: b.ownerUserId === actor.userId }))) }; }))
    .post("/bots", guarded(async ({ actor, body }) => ({ bot: await chat.createBot(actor, parse(botInput, body)) }), 201))
    .patch("/bots/:id", guarded(async ({ actor, body, params }) => { const v = parse(botPatch, body); return { bot: await chat.updateBot(actor, parse(uuid, params.id), v.expectedVersion, v.patch) }; }))
    .post("/bots/:id/onboarding/question", guarded(async ({ actor, body, params }) => chat.askOnboarding(actor, parse(uuid, params.id), parse(z.strictObject({ conversationId: uuid }), body).conversationId), 201))
    .post("/bots/:id/onboarding", guarded(async ({ actor, body, params }) => ({ bot: await chat.answerOnboarding(actor, parse(uuid, params.id), parse(onboarding, body)) })))
    .get("/proposals", guarded(async ({ actor }) => ({ proposals: await chat.listProposals(actor) })))
    .post("/proposals/:id/decision", guarded(async ({ actor, body, params }) => chat.decideProposal(actor, parse(uuid, params.id), parse(z.strictObject({ approve: z.boolean() }), body).approve)))
    .get("/bots/:id/decision", guarded(async ({ actor, params }) => ({ decision: await chat.routing.get(actor, parse(uuid, params.id)) })))
    .put("/bots/:id/decision", guarded(async ({ actor, body, params }) => ({ decision: await chat.routing.set(actor, parse(uuid, params.id), parse(decisionConfigSchema, body)) })))
    .post("/bots/:id/decision/preview", guarded(async ({ actor, body, params }) => ({ route: await chat.routing.preview(actor, parse(uuid, params.id), parse(z.strictObject({ text: z.string().min(1).max(8000) }), body).text) })))
    .get("/harnesses", guarded(async ({ actor }) => ({ harnesses: await chat.harnessReadiness(actor.userId) })))
    .get("/workspaces", guarded(async ({ actor }) => ({ workspaces: await chat.listWorkspaces(actor) })))
    .post("/workspaces", guarded(async ({ actor, body }) => ({ workspace: await chat.createWorkspace(actor, ...(() => { const v = parse(z.strictObject({ name: z.string().trim().min(1).max(80), parentId: uuid.optional() }), body); return [v.name, v.parentId] as const; })()) }), 201))
    .post("/bots/:id/workspace", guarded(async ({ actor, body, params }) => ({ bot: await chat.moveBot(actor, parse(uuid, params.id), parse(z.strictObject({ workspaceId: uuid.nullable() }), body).workspaceId) })))
    .delete("/attachments/:id", guarded(async ({ actor, params }) => ({ attachment: await chat.deleteAttachment(actor, parse(uuid, params.id)) })))
    .patch("/workspaces/:id", guarded(async ({ actor, body, params }) => ({ workspace: await chat.renameWorkspace(actor, parse(uuid, params.id), parse(z.strictObject({ name: z.string().trim().min(1).max(80) }), body).name) })))
    .delete("/workspaces/:id", guarded(async ({ actor, params }) => chat.deleteWorkspace(actor, parse(uuid, params.id))))
    .delete("/bots/:id", guarded(async ({ actor, params }) => ({ bot: await chat.archiveBot(actor, parse(uuid, params.id)) })))
    .get("/conversations", guarded(async ({ actor, query }) => ({ conversations: await chat.listConversations(actor, query.botId ? parse(uuid, query.botId) : undefined) })))
    .post("/conversations", guarded(async ({ actor, body }) => ({ conversation: await chat.createConversation(actor, parse(startChat, body).botId) }), 201))
    .get("/conversations/:id/messages", guarded(async ({ actor, params, query }) => ({ messages: await chat.listMessages(actor, parse(uuid, params.id), { beforeSeq: query.before ? parse(z.coerce.number().int().positive(), query.before) : undefined, limit: query.limit ? parse(z.coerce.number().int().min(1).max(500), query.limit) : undefined }) })))
    .post("/conversations/:id/messages", guarded(async ({ actor, body, params }) => { const v = parse(send, body); return chat.sendMessage(actor, parse(uuid, params.id), v.content, v.parentMessageId, { attachmentIds: v.attachmentIds, fileRefs: v.fileRefs, clientRequestId: v.clientRequestId }); }, 201));
}
