import { uiPrompt } from "@zetta/render/prompt";
import { z } from "zod";

/**
 * Text protocol for bots (works with any harness that only returns text). A bot reply may contain fenced blocks:
 *   ```zetta:remember   {"target": "user"|"memory", "action": "add"|"patch"|"remove", "content": "...", "match": "..."} or {"target", "operations": [...]}
 *   ```zetta:instruction {"title": "...", "body": "..."}
 *   ```zetta:config      {"botId": "<id>", "patch": {"personality": "..."}}   -> becomes a proposal the user must approve
 *   ```zetta:create_bot / create_routine / create_workflow / create_vm  -> proposals shown as a creation summary; nothing exists until the user approves
 *   ```zetta:browser     {"action": "open", "url": "https://..."} | click_text | type | key | read
 *   ```zetta:handoff     {"reason": "I need you to sign in"}                 -> attention item; the human takes over
 *   ```zetta:credential  {"ref": "1password:<item>", "field": "password"}    -> Zetta types a shared login into the focused input (value never shown to the bot)
 *   ```zetta:agenda      {"action": "add", "kind": "task", "title": "...", "start": "<ISO>"} | list | update | complete | remove -> the user's Agenda
 *   ```zetta:discussion  {"action": "open", "title", "goal", "context", "members": [{"bot": "Dev"}], "firstMessage"} | post | update_context | resolve -> group of bots (modules/discussions)
 *   ```zetta:ui          JSON-patch lines building a view from @zetta/render's catalog -> not a tool: it stays in the reply and the web chat draws it
 */
export const TOOL_PREAMBLE = `You can use Zetta tools by writing fenced blocks in your reply (the block name follows the opening backticks):
\`\`\`zetta:remember
{"target":"user","action":"add","content":"a durable preference or fact about the user"}
\`\`\`   (memory is small and bounded. target "user" = who the user is, shared by all their bots (1375 chars); target "memory" = your own notes about working for them (2200 chars). Actions: add{content}, patch{match,content} replaces a unique span inside one entry, remove{match}. Several changes go in one block as {"target":"memory","operations":[{"action":"remove","match":"..."},{"action":"add","content":"..."}]}. If memory is full you get an error with the current entries: shorten or remove some in one batch. Save preferences, corrections, conventions and explicit "remember this"; skip trivia, secrets, one-off details and anything easy to look up again.)
\`\`\`zetta:instruction
{"title":"when to use this","body":"reusable steps learned from this task","trigger":"optional words that should bring it up","verification":"how to check the result"}
\`\`\`
\`\`\`zetta:config
{"botId":"<id of one of the user's bots>","patch":{"personality":"...","instructions":"..."}}
\`\`\`   (only a proposal: the user approves the exact change)
\`\`\`zetta:agenda
{"action":"add","kind":"task","title":"Call Ana about the contract","start":"2026-10-27T09:00:00-03:00"}
\`\`\`   (the user's Agenda, a calendar they see in Zetta. Add what the conversation commits them to: kind task (something to do), reminder (a nudge at a time), event (a meeting or appointment, give "end"), note (context for a day). Fields: title, start, end, allDay, remindAt (defaults to start for tasks and reminders; null for none), description, location, timezone (IANA), syncToGoogle. Dates are ISO 8601 with the user's UTC offset. Other actions: list{from?,to?} (default next 7 days; returns ids), update{id,...fields}, complete{id}, remove{id}. Add only what the user asked for or clearly agreed to; tell them what you added.)
\`\`\`zetta:create_routine
{"botId":"<id of the bot that runs it, usually yours>","title":"Morning Reddit digest","prompt":"complete instructions for one run","timezone":"America/Sao_Paulo","dailyAt":"08:00"}
\`\`\`   (a recurring task; only a proposal: the user approves it, then activates it in Studio > Routines. dailyAt "HH:MM" in that IANA timezone, or everyMinutes (5 to 10080) instead; several times a day = one routine per time. Each run is a new chat turn with your tools, so the prompt must stand on its own. Propose it in your first reply, before using a computer, plugin or reading anything: changes asked for after outside content are ignored.)
${uiPrompt()}
Only use a tool when it is needed.`;

export type ComputerMode = "off" | "browser" | "desktop";
const BROWSER_TOOLS = `
Computer use is enabled for you. It runs in the current user's own isolated session, never anyone else's.
\`\`\`zetta:browser
{"action":"open","url":"https://example.com"}
\`\`\`   (actions: open{url}, click_text{text}, type{text}, key{key}, read. Every action returns the new url and the page text, so you do not need a separate read after it. Only public web addresses open. At most 12 computer actions per turn: plan them, and read the result before the next step. Never type passwords or codes yourself: when the user shared a login with you through a password manager, use zetta:credential; otherwise hand off.)
\`\`\`zetta:handoff
{"reason":"why a person must take over (sign-in, CAPTCHA, payment, anything sensitive)"}
\`\`\`   (the user gets a Take over button in the chat; stop and wait after a handoff)`;
const DESKTOP_TOOLS = `
\`\`\`zetta:desktop
{"action":"navigate","url":"https://example.com"}
\`\`\`   (the user's own persistent Linux computer with Chromium open; sites the user signed in to stay signed in. actions: navigate{url}, click{x,y}, type{text}, key{key, e.g. "Return" or "ctrl+l"}, scroll{direction: up|down|left|right}, launch{app}, read -> text description of the screen. Use read before clicking by coordinates. Add "vm":"<id>" to use one of the user's other computers instead of the default. The user can watch and click along from the chat. Shares the 12 action budget. If a site needs a sign-in, use zetta:credential with "target":"desktop" when the user shared a login for it, otherwise zetta:handoff.)
\`\`\`zetta:create_vm
{"name":"Banking","purpose":"why a separate computer is needed"}
\`\`\`   (only a proposal: asks the user for another computer, e.g. to keep a second account signed in. Use the default computer unless a separate one is really needed.)`;
const CODE_TOOLS = `
Code access is enabled for you. Your shell and file tools run in a persistent workspace folder that belongs to the current user (your current directory): it survives between turns and holds their cloned repositories. Use git directly, no zetta block is needed: run ls first, \`git clone <url>\` if the repository is not there yet, then read, edit, run tests, create branches, commit and push. Git and file edits are already approved, so do not ask the user for permission to run them. Work on a branch unless asked to change the default branch, and never force-push or rewrite history unless the user asks for it. Private repositories and pushes need a GitHub token the user bound to this bot (it is in GITHUB_TOKEN when present); if clone or push fails with an authentication error, say so instead of retrying. Never print, commit or store tokens. Finish by reporting the branch, the commits and what you ran.`;
/** Tool instructions for one bot: browser and desktop are only described when the owner granted that computer-use mode, code only with code access. */
export function toolPreamble(mode: ComputerMode = "off", code = false): string {
  const extra = [
    mode !== "off" ? BROWSER_TOOLS + (mode === "desktop" ? DESKTOP_TOOLS : "") : "",
    code ? CODE_TOOLS : "",
  ]
    .filter(Boolean)
    .map((x) => x.trimStart())
    .join("\n");
  if (!extra) return TOOL_PREAMBLE;
  return TOOL_PREAMBLE.replace(
    /Only use a tool when it is needed\.$/,
    () => `${extra}\nOnly use a tool when it is needed.`,
  );
}

const bounded = (n: number) => z.string().trim().min(1).max(n);
/** Which of the user's computers a desktop action targets; omitted = their default one. */
const vm = z.string().uuid().optional();
const isoDate = z.string().datetime({ offset: true });
const agendaFields = {
  kind: z.enum(["event", "task", "reminder", "note"]).optional(),
  title: bounded(200).optional(),
  start: isoDate.optional(),
  end: isoDate.nullable().optional(),
  allDay: z.boolean().optional(),
  remindAt: isoDate.nullable().optional(),
  description: z.string().max(2000).optional(),
  location: z.string().max(200).optional(),
  timezone: z.string().min(1).max(64).optional(),
  syncToGoogle: z.boolean().optional(),
};
export const toolSchemas = {
  remember: z
    .strictObject({
      target: z.enum(["user", "memory"]).default("memory"),
      action: z.enum(["add", "patch", "remove"]).default("add"),
      content: z.string().trim().min(1).max(600).optional(),
      match: z.string().trim().min(1).max(600).optional(),
      operations: z
        .array(
          z.strictObject({
            action: z.enum(["add", "patch", "remove"]),
            content: z.string().trim().min(1).max(600).optional(),
            match: z.string().trim().min(1).max(600).optional(),
          }),
        )
        .min(1)
        .max(16)
        .optional(),
    })
    .transform((v, ctx) => {
      const raw = v.operations ?? [{ action: v.action, content: v.content, match: v.match }];
      const ops: (
        | { op: "add"; content: string }
        | { op: "patch"; match: string; content: string }
        | { op: "remove"; match: string }
      )[] = [];
      for (const r of raw) {
        if (r.action === "add" && r.content) ops.push({ op: "add", content: r.content });
        else if (r.action === "patch" && r.match && r.content)
          ops.push({ op: "patch", match: r.match, content: r.content });
        else if (r.action === "remove" && r.match) ops.push({ op: "remove", match: r.match });
        else {
          ctx.addIssue({ code: "custom", message: "operation is missing fields" });
          return z.NEVER;
        }
      }
      return { target: v.target, ops };
    }),
  instruction: z.strictObject({
    title: bounded(120),
    body: bounded(8000),
    trigger: z.string().max(300).optional(),
    verification: z.string().max(500).optional(),
  }),
  config: z.strictObject({
    botId: z.string().uuid(),
    patch: z
      .strictObject({
        personality: z.string().max(4096).optional(),
        instructions: z.string().max(16384).optional(),
        description: z.string().max(2048).optional(),
        name: bounded(80).optional(),
        harness: z
          .enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor", "hermes", "fixture"])
          .optional(),
        model: z.string().max(128).nullable().optional(),
      })
      .refine((p) => Object.keys(p).length > 0),
  }),
  browser: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("open"), url: z.string().url().max(2000) }),
    z.strictObject({ action: z.literal("click_text"), text: bounded(200) }),
    z.strictObject({ action: z.literal("type"), text: bounded(2000) }),
    z.strictObject({ action: z.literal("key"), key: bounded(30) }),
    z.strictObject({ action: z.literal("read") }),
  ]),
  handoff: z.strictObject({ reason: bounded(300) }),
  desktop: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("launch"),
      app: z.string().regex(/^[A-Za-z0-9._ -]{1,60}$/),
      vm,
    }),
    z.strictObject({
      action: z.literal("click"),
      x: z.number().min(0).max(8000),
      y: z.number().min(0).max(8000),
      vm,
    }),
    z.strictObject({ action: z.literal("type"), text: bounded(2000), vm }),
    z.strictObject({ action: z.literal("key"), key: bounded(40), vm }),
    z.strictObject({
      action: z.literal("scroll"),
      direction: z.enum(["up", "down", "left", "right"]),
      vm,
    }),
    z.strictObject({ action: z.literal("read"), vm }),
    z.strictObject({ action: z.literal("navigate"), url: z.string().url().max(2000), vm }),
  ]),
  create_vm: z.strictObject({
    name: z
      .string()
      .trim()
      .regex(/^[\p{L}\p{N} ._-]{1,60}$/u),
    purpose: bounded(300),
  }),
  credential: z.strictObject({
    ref: z.string().regex(/^[a-z0-9_-]{1,32}:[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/),
    field: z.enum(["username", "password", "totp"]),
    target: z.enum(["browser", "desktop"]).default("browser"),
    vm,
  }),
  plugin: z.strictObject({
    plugin: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    tool: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  mcp: z.strictObject({
    server: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    tool: bounded(100),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  create_bot: z.strictObject({
    name: bounded(80),
    description: z.string().max(2048).optional(),
    harness: z
      .enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor", "hermes", "fixture"])
      .optional(),
    model: z.string().max(128).nullable().optional(),
    personality: z.string().max(4096).optional(),
    instructions: z.string().max(16384).optional(),
    visibility: z.enum(["private", "team"]).optional(),
  }),
  create_routine: z.strictObject({
    botId: z.string().uuid(),
    title: bounded(120),
    prompt: bounded(8000),
    timezone: bounded(64),
    dailyAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    everyMinutes: z.number().int().min(5).max(10080).optional(),
  }),
  create_workflow: z.strictObject({ name: bounded(120), graph: z.unknown() }),
  discussion: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("open"),
      title: bounded(120),
      goal: bounded(1000),
      context: z.string().max(8000).default(""),
      members: z
        .array(z.strictObject({ bot: bounded(80), role: z.string().trim().max(200).optional() }))
        .min(1)
        .max(5),
      firstMessage: bounded(4000),
    }),
    z.strictObject({
      action: z.literal("post"),
      discussionId: z.string().uuid(),
      text: bounded(4000),
    }),
    z.strictObject({
      action: z.literal("update_context"),
      discussionId: z.string().uuid().optional(),
      text: z.string().max(8000),
    }),
    z.strictObject({
      action: z.literal("resolve"),
      discussionId: z.string().uuid().optional(),
      summary: bounded(2000),
    }),
  ]),
  agenda: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("add"),
      ...agendaFields,
      kind: agendaFields.kind.default("task"),
      title: bounded(200),
      start: isoDate,
    }),
    z.strictObject({ action: z.literal("list"), from: isoDate.optional(), to: isoDate.optional() }),
    z.strictObject({ action: z.literal("update"), id: z.string().uuid(), ...agendaFields }),
    z.strictObject({ action: z.literal("complete"), id: z.string().uuid() }),
    z.strictObject({ action: z.literal("remove"), id: z.string().uuid() }),
  ]),
} as const;
export type ToolCall = {
  [K in keyof typeof toolSchemas]: { kind: K; args: z.infer<(typeof toolSchemas)[K]> };
}[keyof typeof toolSchemas];

/** Extracts valid tool calls (max 8) and returns the reply with the blocks removed. Invalid blocks are dropped silently. */
export function parseTools(reply: string): { calls: ToolCall[]; text: string } {
  const calls: ToolCall[] = [];
  const text = reply
    .replace(
      /```zetta:(remember|instruction|config|browser|handoff|create_bot|create_routine|create_workflow|create_vm|mcp|plugin|desktop|credential|agenda|discussion)\s*\n([\s\S]*?)```/g,
      (_, kind: keyof typeof toolSchemas, body: string) => {
        if (calls.length < 8) {
          try {
            const parsed = toolSchemas[kind].safeParse(JSON.parse(body));
            if (parsed.success) calls.push({ kind, args: parsed.data } as ToolCall);
          } catch {
            /* malformed JSON is ignored */
          }
        }
        return "";
      },
    )
    .trim();
  return { calls, text };
}

export type WhatsappBody =
  | {
      kind: "chats";
      hour12: boolean;
      chats: { id: string; name: string; last: string; fromMe: boolean }[];
    }
  | {
      kind: "messages";
      hour12: boolean;
      name: string;
      chat: string;
      messages: { at: number; from: string; text: string; media: boolean }[];
    };

/**
 * Data for a trusted ```zetta:whatsapp block built by the server (never by the model) from a WhatsApp read tool's own output, so the chat
 * can draw it like WhatsApp. The plugin already sanitised the text; we only keep the fields the view needs. Anything unexpected is undefined.
 */
export function whatsappView(plugin: string, tool: string, out: string): WhatsappBody | undefined {
  if (plugin !== "whatsapp" || (tool !== "list_chats" && tool !== "read_messages"))
    return undefined;
  try {
    const d = JSON.parse(out) as {
      timeFormat?: unknown;
      name?: unknown;
      chat?: unknown;
      chats?: { id?: unknown; name?: unknown; lastMessage?: unknown; lastFromMe?: unknown }[];
      messages?: { at?: unknown; from?: unknown; text?: unknown; media?: unknown }[];
    };
    const hour12 = d.timeFormat === "12h";
    return tool === "list_chats"
      ? {
          kind: "chats",
          hour12,
          chats: (d.chats ?? []).slice(0, 20).map((c) => ({
            id: String(c.id ?? ""),
            name: String(c.name ?? ""),
            last: String(c.lastMessage ?? ""),
            fromMe: Boolean(c.lastFromMe),
          })),
        }
      : {
          kind: "messages",
          hour12,
          name: String(d.name ?? ""),
          chat: String(d.chat ?? ""),
          messages: (d.messages ?? []).slice(0, 20).map((m) => ({
            at: Number(m.at) || 0,
            from: String(m.from ?? ""),
            text: String(m.text ?? ""),
            media: Boolean(m.media),
          })),
        };
  } catch {
    return undefined;
  }
}

/** One card per conversation: repeated reads of the same chat (the bot often calls read_messages several times) are merged, de-duplicated and time-ordered. */
export function whatsappBlocks(views: WhatsappBody[]): string[] {
  const merged = new Map<string, WhatsappBody>();
  for (const v of views) {
    const key = v.kind === "chats" ? "chats" : `chat:${v.chat}`,
      prev = merged.get(key);
    if (!prev) {
      merged.set(key, structuredClone(v));
      continue;
    }
    if (prev.kind === "messages" && v.kind === "messages") {
      const seen = new Set(prev.messages.map((m) => `${m.at}|${m.from}|${m.text}|${m.media}`));
      for (const m of v.messages)
        if (!seen.has(`${m.at}|${m.from}|${m.text}|${m.media}`)) prev.messages.push(m);
      prev.messages.sort((a, b) => a.at - b.at);
      prev.name ||= v.name;
    } else if (prev.kind === "chats" && v.kind === "chats") merged.set(key, structuredClone(v)); // newest list wins
  }
  return [...merged.values()].map(
    (b) => `\`\`\`zetta:whatsapp\n${JSON.stringify(b).replace(/`/g, "'")}\n\`\`\``,
  );
}
