import { z } from "zod";

/**
 * Text protocol for bots (works with any harness that only returns text). A bot reply may contain fenced blocks:
 *   ```zetta:remember   {"target": "user"|"memory", "action": "add"|"patch"|"remove", "content": "...", "match": "..."} or {"target", "operations": [...]}
 *   ```zetta:instruction {"title": "...", "body": "..."}
 *   ```zetta:config      {"botId": "<id>", "patch": {"personality": "..."}}   -> becomes a proposal the user must approve
 *   ```zetta:create_bot / create_routine / create_workflow  -> proposals shown as a creation summary; nothing exists until the user approves
 *   ```zetta:browser     {"action": "open", "url": "https://..."} | click_text | type | key | read
 *   ```zetta:handoff     {"reason": "I need you to sign in"}                 -> attention item; the human takes over
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
\`\`\`zetta:browser
{"action":"open","url":"https://example.com"}
\`\`\`   (actions: open{url}, click_text{text}, type{text}, key{key}, read; you will receive the page text)
\`\`\`zetta:handoff
{"reason":"why a person must take over the browser"}
\`\`\`
Only use a tool when it is needed.`;

const bounded = (n: number) => z.string().trim().min(1).max(n);
export const toolSchemas = {
  remember: z.strictObject({
    target: z.enum(["user", "memory"]).default("memory"), action: z.enum(["add", "patch", "remove"]).default("add"), content: z.string().trim().min(1).max(600).optional(), match: z.string().trim().min(1).max(600).optional(),
    operations: z.array(z.strictObject({ action: z.enum(["add", "patch", "remove"]), content: z.string().trim().min(1).max(600).optional(), match: z.string().trim().min(1).max(600).optional() })).min(1).max(16).optional(),
  }).transform((v, ctx) => {
    const raw = v.operations ?? [{ action: v.action, content: v.content, match: v.match }];
    const ops: ({ op: "add"; content: string } | { op: "patch"; match: string; content: string } | { op: "remove"; match: string })[] = [];
    for (const r of raw) {
      if (r.action === "add" && r.content) ops.push({ op: "add", content: r.content });
      else if (r.action === "patch" && r.match && r.content) ops.push({ op: "patch", match: r.match, content: r.content });
      else if (r.action === "remove" && r.match) ops.push({ op: "remove", match: r.match });
      else { ctx.addIssue({ code: "custom", message: "operation is missing fields" }); return z.NEVER; }
    }
    return { target: v.target, ops };
  }),
  instruction: z.strictObject({ title: bounded(120), body: bounded(8000), trigger: z.string().max(300).optional(), verification: z.string().max(500).optional() }),
  config: z.strictObject({ botId: z.string().uuid(), patch: z.strictObject({ personality: z.string().max(4096).optional(), instructions: z.string().max(16384).optional(), description: z.string().max(2048).optional(), name: bounded(80).optional(), harness: z.enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor", "fixture"]).optional(), model: z.string().max(128).nullable().optional() }).refine((p) => Object.keys(p).length > 0) }),
  browser: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("open"), url: z.string().url().max(2000) }), z.strictObject({ action: z.literal("click_text"), text: bounded(200) }),
    z.strictObject({ action: z.literal("type"), text: bounded(2000) }), z.strictObject({ action: z.literal("key"), key: bounded(30) }), z.strictObject({ action: z.literal("read") }),
  ]),
  handoff: z.strictObject({ reason: bounded(300) }),
  desktop: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("launch"), app: z.string().regex(/^[A-Za-z0-9._ -]{1,60}$/) }), z.strictObject({ action: z.literal("click"), x: z.number().min(0).max(8000), y: z.number().min(0).max(8000) }),
    z.strictObject({ action: z.literal("type"), text: bounded(2000) }), z.strictObject({ action: z.literal("key"), key: bounded(40) }),
    z.strictObject({ action: z.literal("scroll"), direction: z.enum(["up", "down", "left", "right"]) }), z.strictObject({ action: z.literal("read") }),
  ]),
  mcp: z.strictObject({ server: z.string().regex(/^[a-z0-9_-]{1,32}$/), tool: bounded(100), args: z.record(z.string(), z.unknown()).default({}) }),
  create_bot: z.strictObject({ name: bounded(80), description: z.string().max(2048).optional(), harness: z.enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor", "fixture"]).optional(), model: z.string().max(128).nullable().optional(), personality: z.string().max(4096).optional(), instructions: z.string().max(16384).optional(), visibility: z.enum(["private", "team"]).optional() }),
  create_routine: z.strictObject({ botId: z.string().uuid(), title: bounded(120), prompt: bounded(8000), timezone: bounded(64), dailyAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), everyMinutes: z.number().int().min(5).max(10080).optional() }),
  create_workflow: z.strictObject({ name: bounded(120), graph: z.unknown() }),
} as const;
export type ToolCall = { [K in keyof typeof toolSchemas]: { kind: K; args: z.infer<(typeof toolSchemas)[K]> } }[keyof typeof toolSchemas];

/** Extracts valid tool calls (max 8) and returns the reply with the blocks removed. Invalid blocks are dropped silently. */
export function parseTools(reply: string): { calls: ToolCall[]; text: string } {
  const calls: ToolCall[] = [];
  const text = reply.replace(/```zetta:(remember|instruction|config|browser|handoff|create_bot|create_routine|create_workflow|mcp|desktop)\s*\n([\s\S]*?)```/g, (_, kind: keyof typeof toolSchemas, body: string) => {
    if (calls.length < 8) {
      try { const parsed = toolSchemas[kind].safeParse(JSON.parse(body)); if (parsed.success) calls.push({ kind, args: parsed.data } as ToolCall); } catch { /* malformed JSON is ignored */ }
    }
    return "";
  }).trim();
  return { calls, text };
}
