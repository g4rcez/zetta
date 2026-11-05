import { OUTPUT_STYLE_KEYS } from "@zetta/db/schema/output-styles";
import { Elysia } from "elysia";
import { z } from "zod";
import { skillName } from "../bot-claude/profile";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { OutputStyleError } from "../output-styles/service";
import {
  AttachmentError,
  DiscussionConversationError,
  BotNameError,
  FallbackError,
  ModelError,
  NotReadyError,
  OnboardingError,
  ProposalSelectionError,
  TurnBusyError,
  type ChatEvent,
  type ChatService,
} from "./service";
import { IMAGE_TYPES } from "./images";
import { interviewInput, interviewTurn } from "./bot-interview";
import { decisionConfigSchema } from "./routing";
import { FileAccessError, type FileStore } from "./files";
import { createUIMessageStreamResponse } from "ai";
import { toUIMessageStream } from "./ui-stream";
import { accessFail, createGuardedRoute, fail, out, rejectUntrustedOrigin } from "../http-response";

export type ChatServices = {
  access: ReturnType<typeof createIdentityAccess>;
  chat: ChatService;
  files?: FileStore;
};

const uuid = z.string().uuid();
// The /workspaces routes in the chain below are deprecated aliases of the /folders routes, from when folders were called
// workspaces: same work, old body and response keys. Remove them one release after the rename. (The note lives here because a
// comment inside the chain makes the formatter re-indent all of it.)
const newFolderBody = z.strictObject({
  name: z.string().trim().min(1).max(80),
  parentId: uuid.optional(),
});
const renameFolderBody = z.strictObject({ name: z.string().trim().min(1).max(80) });
/** Every bot the API returns says whether the caller may change it, so a client that keeps the returned bot (onboarding, settings) stays editable. */
const editable = <B extends { ownerUserId: string } | undefined>(actor: { userId: string }, b: B) =>
  b && { ...b, canEdit: b.ownerUserId === actor.userId };
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const botAvatar = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("preset"),
    preset: z.string().regex(/^[a-z0-9-]{1,32}$/),
    colors: z.array(hexColor).min(1).max(4),
  }),
  z.strictObject({
    kind: z.literal("image"),
    src: z
      .string()
      .max(300_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  }),
]);
/** Per-user timestamps of recent setup-interview calls (each one runs the engine). */
const interviewCalls = new Map<string, number[]>();
const botInput = z.strictObject({
  avatar: botAvatar.nullable().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2048).optional(),
  visibility: z.enum(["private", "team"]).optional(),
  harness: z
    .enum([
      "pi",
      "codex",
      "omp",
      "claude-code",
      "opencode",
      "cursor",
      "hermes",
      "deepseek",
      "fixture",
      "decision",
    ])
    .optional(),
  model: z.string().max(128).nullable().optional(),
  fallbackHarness: z
    .enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor", "hermes", "deepseek"])
    .nullable()
    .optional(),
  fallbackModel: z.string().max(128).nullable().optional(),
  personality: z.string().max(4096).optional(),
  instructions: z.string().max(16384).optional(),
  outputStyle: z.enum(OUTPUT_STYLE_KEYS).optional(),
  outputStyleId: z.string().uuid().nullable().optional(),
  computerMode: z.enum(["off", "browser", "desktop"]).optional(),
  codeAccess: z.boolean().optional(),
  commitIdentity: z.enum(["git-config", "bot", "account", "custom"]).optional(),
  commitEmail: z.email().max(254).nullable().optional(),
  requiredConnections: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z0-9_-]{1,32}$/),
        provider: z.enum(["anthropic", "openai", "google", "openrouter", "deepseek", "github"]),
      }),
    )
    .max(8)
    .optional(),
});
const botPatch = z.strictObject({
  expectedVersion: z.number().int().positive(),
  patch: botInput.partial(),
});
const onboarding = z.strictObject({
  conversationId: uuid,
  questionId: uuid,
  expectedVersion: z.number().int().positive(),
  satisfied: z.boolean(),
});
const decision = z.strictObject({
  approve: z.boolean(),
  /** Only for a proposal to install skills: which of the offered skills, and whose bots get them. */
  selection: z
    .strictObject({
      paths: z.array(z.string().min(1).max(300)).min(1).max(25),
      target: z.enum(["bot", "all", "picked"]),
    })
    .optional(),
});
const sendBody = z.strictObject({
  clientRequestId: z.string().min(8).max(100).optional(),
  content: z.string().trim().max(32768),
  parentMessageId: uuid.optional(),
  quotedMessageId: uuid.optional(),
  attachmentIds: z.array(uuid).max(5).optional(),
  fileRefs: z.array(z.string().min(1).max(300)).max(5).optional(),
  wikiIds: z.array(uuid).max(5).optional(),
  skills: z.array(skillName).max(5).optional(),
});
/** A message may be only pictures or files, but never empty. */
const hasBody = (v: {
  content: string;
  attachmentIds?: string[] | undefined;
  fileRefs?: string[] | undefined;
}) => !!v.content || !!v.attachmentIds?.length || !!v.fileRefs?.length;
const send = sendBody.refine(hasBody);
const conversationPatch = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
});
const upload = z.strictObject({
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().max(100).default("text/plain"),
  text: z.string().max(262144),
  conversationId: uuid.optional(),
});
/** A picture travels as base64 inside JSON (10 MB of bytes is ~14 MB of text). */
const uploadImage = z.strictObject({
  name: z.string().trim().min(1).max(200),
  mimeType: z.enum(IMAGE_TYPES),
  dataBase64: z.string().min(1).max(14_000_000),
  conversationId: uuid.optional(),
});
const noFiles: FileStore = {
  list: async () => {
    throw new FileAccessError("NOT_FOUND");
  },
  read: async () => {
    throw new FileAccessError("NOT_FOUND");
  },
  readWithHash: async () => {
    throw new FileAccessError("NOT_FOUND");
  },
};
const filePath = z.string().min(1).max(300);
const startChat = z.strictObject({ botId: uuid });

export function createChatRoutes(
  { access, chat, files }: ChatServices,
  trustedOrigins: readonly string[],
) {
  const guarded = createGuardedRoute({ access, trustedOrigins, mapError });
  const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => schema.parse(value);

  /** Server-sent events with cursor ids: `id: n` per frame. The turn keeps running if the connection drops; reconnect with
   * GET /conversations/:id/stream?after=n. Authorization/validation errors are plain JSON before any event. */
  function sse(follow: AsyncGenerator<{ n: number; event: unknown }>, onClose: () => void) {
    const encoder = new TextEncoder();
    let beat: ReturnType<typeof setInterval> | undefined;
    return new Response(
      new ReadableStream({
        async start(controller) {
          // A bot can work for hours without a word; a comment frame keeps proxies and the server's idle timeout from closing the stream.
          beat = setInterval(
            () => {
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                /* closed */
              }
            },
            Number(process.env.ZETTA_SSE_HEARTBEAT_MS ?? 30_000),
          );
          try {
            for await (const { n, event } of follow)
              controller.enqueue(encoder.encode(`id: ${n}\ndata: ${JSON.stringify(event)}\n\n`));
          } catch {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error" })}\n\n`));
            } catch {
              /* closed */
            }
          }
          clearInterval(beat);
          try {
            controller.close();
          } catch {
            /* closed */
          }
        },
        cancel() {
          // The client left: stop the heartbeat and the follower (it ends at its next wake-up, at most 15 s).
          clearInterval(beat);
          void follow.return(undefined).catch(() => {});
          onClose();
        }, // dropping the connection never cancels the turn
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      },
    );
  }
  async function streamReply({
    request,
    body,
    params,
  }: {
    request: Request;
    body: unknown;
    params: Record<string, string>;
  }) {
    try {
      const denied = rejectUntrustedOrigin(request, trustedOrigins);
      if (denied) return denied;
      const actor = await access.requireActive(request.headers);
      const turn = await chat.startTurn(actor, parse(uuid, params.id), parse(send, body));
      return sse(turn.follow(0), () => {});
    } catch (error) {
      return mapError(error);
    }
  }
  async function resumeReply({
    request,
    params,
    query,
  }: {
    request: Request;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
  }) {
    try {
      const actor = await access.requireActive(request.headers);
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .parse(query.after ?? 0);
      const turn = await chat.resumeTurn(
        actor,
        parse(uuid, params.id),
        after,
        query.turn ? parse(uuid, query.turn) : undefined,
      );
      if (!turn) return out({ resumable: false });
      return sse(turn.follow(), () => {});
    } catch (error) {
      return mapError(error);
    }
  }
  /** AI SDK UI message stream of a turn, always from its first event; a failed turn ends with an `error` chunk. */
  function uiStream(turn: {
    rec: { error?: unknown };
    follow: () => AsyncGenerator<{ event: ChatEvent }>;
  }) {
    const events = async function* () {
      for await (const { event } of turn.follow()) yield event;
      if (turn.rec.error) throw turn.rec.error;
    };
    return createUIMessageStreamResponse({
      stream: toUIMessageStream(events()),
      headers: { "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  }
  async function chatReply({
    request,
    body,
    params,
  }: {
    request: Request;
    body: unknown;
    params: Record<string, string>;
  }) {
    try {
      const denied = rejectUntrustedOrigin(request, trustedOrigins);
      if (denied) return denied;
      const actor = await access.requireActive(request.headers);
      const id = parse(uuid, params.id);
      const input = parse(send, body);
      // A busy chat queues the message: it is saved now and answered in its thread when the turns before it end.
      const turn = (await chat.isBusy(actor, id))
        ? undefined
        : await chat.startTurn(actor, id, input).catch((e) => {
            if (e instanceof TurnBusyError) return undefined;
            throw e;
          });
      if (turn) return uiStream({ rec: turn.rec, follow: () => turn.follow(0) });
      const saved = await chat.enqueue(actor, id, input);
      return uiStream({
        rec: {},
        follow: async function* () {
          yield { event: { type: "user", message: saved } as const };
          yield { event: { type: "done" } as const };
        },
      });
    } catch (error) {
      return mapError(error);
    }
  }
  async function resumeChat({
    request,
    params,
    query,
  }: {
    request: Request;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
  }) {
    try {
      const actor = await access.requireActive(request.headers);
      // `turn`: a room runs several bots at once, each turn has its own stream.
      const turn = await chat.resumeTurn(
        actor,
        parse(uuid, params.id),
        0,
        query.turn ? parse(uuid, query.turn) : undefined,
      );
      if (!turn || turn.rec.done)
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return uiStream(turn);
    } catch (error) {
      return mapError(error);
    }
  }
  function mapError(error: unknown) {
    if (error instanceof AccessError) return accessFail(error);
    if (error instanceof ProposalSelectionError)
      return fail(400, "CHOOSE_SKILLS", "Choose at least one of the skills the bot offered.");
    if (error instanceof NotReadyError)
      return fail(
        409,
        "BOT_NOT_READY",
        "This bot is not ready yet. Its owner has to finish setting it up first.",
      );
    if (error instanceof TurnBusyError)
      return fail(
        409,
        "TURN_BUSY",
        "This chat is still answering. Wait for it to finish or cancel it.",
      );
    if (error instanceof DiscussionConversationError)
      return fail(
        409,
        "DISCUSSION_CONVERSATION",
        "This is a room where bots talk. Post in it from the Rooms page.",
      );
    if (error instanceof OnboardingError)
      return fail(
        409,
        error.code,
        error.code === "FIXTURE_NOT_EVIDENCE"
          ? "Choose a real harness for this bot first; the offline fixture cannot confirm readiness."
          : "Chat with the bot first, then say whether you are satisfied.",
      );
    if (error instanceof BotNameError)
      return fail(
        400,
        "BOT_NAME_RESERVED",
        "user, channel, here and all are reserved for mentions. Choose another name.",
      );
    if (error instanceof OutputStyleError)
      return fail(
        400,
        "OUTPUT_STYLE_INVALID",
        "Choose an output style from the list. A shared style must still be shared with you.",
      );
    if (error instanceof ModelError)
      return fail(
        400,
        "MODEL_NOT_ALLOWED",
        "That model isn't available for this harness. Pick one from the list or use the harness default.",
      );
    if (error instanceof FallbackError)
      return fail(
        400,
        "FALLBACK_INVALID",
        "The fallback must be a different harness from the main one, with a model that harness offers.",
      );
    if (error instanceof AttachmentError)
      return fail(
        400,
        "ATTACHMENT_INVALID",
        "Attach a text file up to 256 KB or a PNG, JPEG, WebP or GIF image up to 10 MB.",
      );
    if (error instanceof FileAccessError)
      return fail(
        error.code === "NOT_FOUND" ? 404 : 400,
        error.code,
        "That file is not available.",
      );
    if (error instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "CHAT_UNAVAILABLE", "Something went wrong. Please retry.");
  }

  return new Elysia({ prefix: "/api", normalize: false })
    .post("/conversations/:id/stream", streamReply)
    .get("/conversations/:id/stream", resumeReply)
    .post("/conversations/:id/chat", chatReply)
    .get("/conversations/:id/chat/stream", resumeChat)
    .post(
      "/conversations/:id/queue",
      guarded(
        async ({ actor, body, params }) => ({
          message: await chat.enqueue(actor, parse(uuid, params.id), parse(send, body)),
        }),
        201,
      ),
    )
    .delete(
      "/conversations/:id/queue/:messageId",
      guarded(async ({ actor, params }) =>
        chat.removeQueued(actor, parse(uuid, params.id), parse(uuid, params.messageId)),
      ),
    )
    .post(
      "/conversations/:id/queue/:messageId/retry",
      guarded(async ({ actor, params }) =>
        chat.retryQueued(actor, parse(uuid, params.id), parse(uuid, params.messageId)),
      ),
    )
    .post(
      "/conversations/:id/cancel",
      guarded(async ({ actor, params }) => ({
        cancelled: await chat.cancelTurn(actor, parse(uuid, params.id)),
      })),
    )
    .get(
      "/conversations/:id/turn",
      guarded(async ({ actor, params }) => chat.turnState(actor, parse(uuid, params.id))),
    )
    .post(
      "/conversations/:id/turn/wait",
      guarded(async ({ actor, params }) => chat.keepWaiting(actor, parse(uuid, params.id))),
    )
    .get(
      "/conversations/:id/loops",
      guarded(async ({ actor, params }) => ({
        loops: await chat.listLoops(actor, parse(uuid, params.id)),
      })),
    )
    .post(
      "/loops/:id/stop",
      guarded(async ({ actor, params }) => ({
        loop: await chat.setLoop(actor, parse(uuid, params.id), "cancelled"),
      })),
    )
    .post(
      "/loops/:id/resume",
      guarded(async ({ actor, params }) => ({
        loop: await chat.setLoop(actor, parse(uuid, params.id), "running"),
      })),
    )
    .post(
      "/attachments",
      guarded(
        async ({ actor, body }) => ({
          attachment:
            body && typeof body === "object" && "dataBase64" in body
              ? await chat.addImageAttachment(actor, parse(uploadImage, body))
              : await chat.addAttachment(actor, parse(upload, body)),
        }),
        201,
      ),
    )
    .get(
      "/files",
      guarded(async ({ actor, query }) => ({
        entries: await (files ?? noFiles).list(
          actor.userId,
          parse(filePath, query.path ?? "shared"),
        ),
      })),
    )
    .get(
      "/files/content",
      guarded(async ({ actor, query }) => ({
        text: await (files ?? noFiles).read(actor.userId, parse(filePath, query.path)),
      })),
    )
    .get(
      "/bots",
      guarded(async ({ actor }) => {
        let rows = await chat.listBots(actor);
        // The list is polled: ask for the chief only when the person has none yet (the first visit).
        if (!rows.some((b) => b.kind === "chief" && b.ownerUserId === actor.userId)) {
          await chat.ensureChief(actor);
          rows = await chat.listBots(actor);
        }
        return { bots: rows.map((b) => editable(actor, b)) };
      }),
    )
    .get(
      "/bots/status",
      guarded(async ({ actor }) => ({ statuses: await chat.botStatus(actor) })),
    )
    .post(
      "/bots",
      guarded(
        async ({ actor, body }) => ({
          bot: editable(actor, await chat.createBot(actor, parse(botInput, body))),
        }),
        201,
      ),
    )
    .post(
      "/bots/interview",
      guarded(async ({ actor, body }) => {
        const now = Date.now();
        const recent = (interviewCalls.get(actor.userId) ?? []).filter((t) => now - t < 60_000);
        if (recent.length >= 20)
          return { kind: "unavailable", reason: "Too many requests. Wait a minute and try again." };
        interviewCalls.set(actor.userId, [...recent, now]);
        const input = parse(interviewInput, body);
        // A decision model cannot write: the owner's Chief interviews in its place.
        const chief = input.harness === "decision" ? await chat.ensureChief(actor) : null;
        return interviewTurn(input, { userId: actor.userId, chief });
      }),
    )
    .patch(
      "/bots/:id",
      guarded(async ({ actor, body, params }) => {
        const v = parse(botPatch, body);
        return {
          bot: editable(
            actor,
            await chat.updateBot(actor, parse(uuid, params.id), v.expectedVersion, v.patch),
          ),
        };
      }),
    )
    .post(
      "/bots/:id/onboarding/question",
      guarded(
        async ({ actor, body, params }) =>
          chat.askOnboarding(
            actor,
            parse(uuid, params.id),
            parse(z.strictObject({ conversationId: uuid }), body).conversationId,
          ),
        201,
      ),
    )
    .post(
      "/bots/:id/onboarding",
      guarded(async ({ actor, body, params }) => ({
        bot: editable(
          actor,
          await chat.answerOnboarding(actor, parse(uuid, params.id), parse(onboarding, body)),
        ),
      })),
    )
    .get(
      "/proposals",
      guarded(async ({ actor, query }) => ({
        proposals: await chat.listProposals(
          actor,
          query.botId ? parse(uuid, query.botId) : undefined,
        ),
      })),
    )
    .post(
      "/proposals/:id/decision",
      guarded(async ({ actor, body, params }) =>
        chat.decideProposal(
          actor,
          parse(uuid, params.id),
          ...((d) => [d.approve, d.selection] as const)(parse(decision, body)),
        ),
      ),
    )
    .get(
      "/bots/:id/skills",
      guarded(async ({ actor, params }) => ({
        skills: await chat.botSkills(actor, parse(uuid, params.id)),
      })),
    )
    .get(
      "/bots/:id/decision",
      guarded(async ({ actor, params }) => ({
        decision: await chat.routing.get(actor, parse(uuid, params.id)),
      })),
    )
    .put(
      "/bots/:id/decision",
      guarded(async ({ actor, body, params }) => ({
        decision: await chat.routing.set(
          actor,
          parse(uuid, params.id),
          parse(decisionConfigSchema, body),
        ),
      })),
    )
    .post(
      "/bots/:id/decision/preview",
      guarded(async ({ actor, body, params }) => ({
        route: await chat.routing.preview(
          actor,
          parse(uuid, params.id),
          parse(z.strictObject({ text: z.string().min(1).max(8000) }), body).text,
        ),
      })),
    )
    .get(
      "/harnesses",
      guarded(async ({ actor }) => ({ harnesses: await chat.harnessReadiness(actor.userId) })),
    )
    .get(
      "/folders",
      guarded(async ({ actor }) => ({ folders: await chat.listFolders(actor) })),
    )
    .post(
      "/folders",
      guarded(async ({ actor, body }) => {
        const v = parse(newFolderBody, body);
        return { folder: await chat.createFolder(actor, v.name, v.parentId) };
      }, 201),
    )
    .post(
      "/bots/:id/folder",
      guarded(async ({ actor, body, params }) => ({
        bot: editable(
          actor,
          await chat.moveBot(
            actor,
            parse(uuid, params.id),
            parse(z.strictObject({ folderId: uuid.nullable() }), body).folderId,
          ),
        ),
      })),
    )
    .get(
      "/workspaces",
      guarded(async ({ actor }) => ({ workspaces: await chat.listFolders(actor) })),
    )
    .post(
      "/workspaces",
      guarded(async ({ actor, body }) => {
        const v = parse(newFolderBody, body);
        return { workspace: await chat.createFolder(actor, v.name, v.parentId) };
      }, 201),
    )
    .post(
      "/bots/:id/workspace",
      guarded(async ({ actor, body, params }) => ({
        bot: editable(
          actor,
          await chat.moveBot(
            actor,
            parse(uuid, params.id),
            parse(z.strictObject({ workspaceId: uuid.nullable() }), body).workspaceId,
          ),
        ),
      })),
    )
    .get("/attachments/:id/content", async ({ request, params }) => {
      try {
        const actor = await access.requireActive(request.headers);
        const f = await chat.imageFile(actor, parse(uuid, params.id));
        const file = Bun.file(f.path);
        if (!(await file.exists())) return fail(404, "NOT_FOUND", "That image is not available.");
        return new Response(file, {
          headers: {
            "content-type": f.mimeType,
            "content-disposition": "inline",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      } catch (error) {
        return mapError(error);
      }
    })
    .delete(
      "/attachments/:id",
      guarded(async ({ actor, params }) => ({
        attachment: await chat.deleteAttachment(actor, parse(uuid, params.id)),
      })),
    )
    .patch(
      "/folders/:id",
      guarded(async ({ actor, body, params }) => ({
        folder: await chat.renameFolder(
          actor,
          parse(uuid, params.id),
          parse(renameFolderBody, body).name,
        ),
      })),
    )
    .delete(
      "/folders/:id",
      guarded(async ({ actor, params }) => chat.deleteFolder(actor, parse(uuid, params.id))),
    )
    .patch(
      "/workspaces/:id",
      guarded(async ({ actor, body, params }) => ({
        workspace: await chat.renameFolder(
          actor,
          parse(uuid, params.id),
          parse(renameFolderBody, body).name,
        ),
      })),
    )
    .delete(
      "/workspaces/:id",
      guarded(async ({ actor, params }) => chat.deleteFolder(actor, parse(uuid, params.id))),
    )
    .delete(
      "/bots/:id",
      guarded(async ({ actor, params }) => ({
        bot: await chat.archiveBot(actor, parse(uuid, params.id)),
      })),
    )
    .get(
      "/conversations",
      guarded(async ({ actor, query }) => ({
        conversations: await chat.listConversations(
          actor,
          query.botId ? parse(uuid, query.botId) : undefined,
          query.kind ? parse(z.enum(["chat", "discussion", "inbound"]), query.kind) : undefined,
          query.archived === "true",
        ),
      })),
    )
    .post(
      "/conversations",
      guarded(
        async ({ actor, body }) => ({
          conversation: await chat.createConversation(actor, parse(startChat, body).botId),
        }),
        201,
      ),
    )
    .get(
      "/conversations/:id",
      guarded(async ({ actor, params }) => ({
        conversation: await chat.getConversation(actor, parse(uuid, params.id)),
      })),
    )
    .patch(
      "/conversations/:id",
      guarded(async ({ actor, body, params }) => ({
        conversation: await chat.updateConversation(
          actor,
          parse(uuid, params.id),
          parse(conversationPatch, body),
        ),
      })),
    )
    .delete(
      "/conversations/:id",
      guarded(async ({ actor, params }) => ({
        deleted: await chat.deleteConversation(actor, parse(uuid, params.id)),
      })),
    )
    .get(
      "/conversations/:id/messages",
      guarded(async ({ actor, params, query }) => ({
        messages: await chat.listMessages(actor, parse(uuid, params.id), {
          beforeSeq: query.before
            ? parse(z.coerce.number().int().positive(), query.before)
            : undefined,
          limit: query.limit
            ? parse(z.coerce.number().int().min(1).max(500), query.limit)
            : undefined,
        }),
      })),
    )
    .post(
      "/conversations/:id/messages",
      guarded(async ({ actor, body, params }) => {
        const v = parse(send, body);
        return chat.sendMessage(actor, parse(uuid, params.id), v.content, v.parentMessageId, {
          quotedMessageId: v.quotedMessageId,
          attachmentIds: v.attachmentIds,
          fileRefs: v.fileRefs,
          wikiIds: v.wikiIds,
          skills: v.skills,
          clientRequestId: v.clientRequestId,
        });
      }, 201),
    );
}
