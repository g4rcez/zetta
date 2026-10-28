import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, asc, eq, ne } from "@zetta/db/query";
import { bot as botTable, type bot } from "@zetta/db/schema/chat";
import { computerVm, hook as hooks } from "@zetta/db/schema/features";
import { raiseAttention } from "../features/attention";
import { createKnowledge, renderMemory, type MemorySnapshot } from "../features/knowledge";
import { applyRedaction, matches, safeRegex } from "../features/safety";
import { buildProfile, DEFAULT_CONFIG } from "../bot-claude/profile";
import { createBotClaude } from "../bot-claude/store";
import { buildHistory } from "./context";
import { fixtureResponder } from "./fixture";
import {
  HarnessError,
  runCli,
  streamCli,
  type CliImage,
  type NativeHarness,
  type RunCli,
  type StreamCli,
} from "./harness";
import { toolPreamble } from "./tools";

type Bot = typeof bot.$inferSelect;
type Hook = typeof hooks.$inferSelect;
export type Used = { memories: { id: string }[]; instructions: { id: string }[] };
/** userId is the requesting user: memory and instructions always come from them, never from the bot owner. */
export type Turn = {
  signal?: AbortSignal | undefined;
  parentMessageId?: string | null;
  userId: string;
  bot: Bot;
  history: readonly { role: string; content: string }[];
  prompt: string;
  /** Called with the knowledge that went into the prompt (for provenance on the answer). */
  onUsed?: ((u: Used) => void) | undefined;
  /** Per-run provider keys for this user (see connections). */
  extraEnv?: Record<string, string> | undefined;
  /** Frozen memory for this conversation; without one (routines, workflows) the live stores are read. */
  memorySnapshot?: MemorySnapshot | undefined;
  /** Plugins this user bound to the bot (see integrations/plugins): tool list + call format. Built by the chat service. */
  pluginTools?: string | undefined;
  /** Forces code access off for this turn (outside content in play: inbound threads, unapproved group discussions). */
  noCode?: boolean | undefined;
  /** Turn-specific tool text appended after the plugin tools (e.g. group discussions). */
  extraTools?: string | undefined;
  /** Pictures attached to the message (absolute paths); staged next to the run by the harness. */
  images?: CliImage[] | undefined;
  /** Continue this Claude Code session (a run a server restart cut off) instead of starting a new one. */
  resumeSession?: string | undefined;
  /** Called with the Claude Code session id when the run is one that can be resumed (a code workspace), so the caller can record it. */
  onSession?: ((id: string) => void) | undefined;
};
export type TurnResult = { text: string; stopped: boolean };

/** `ZETTA_CODE_ACCESS=off` is the operator's kill switch; otherwise the bot owner's `codeAccess` setting decides. Fixture bots never run code. */
export const codeEnabled = (
  b: Pick<Bot, "codeAccess" | "harness">,
  userId?: string,
  noCode?: boolean,
) =>
  Boolean(userId) &&
  !noCode &&
  b.codeAccess &&
  b.harness !== "fixture" &&
  process.env.ZETTA_CODE_ACCESS !== "off";
const codeFor = (b: Bot, userId?: string, noCode?: boolean) =>
  codeEnabled(b, userId, noCode) ? { code: { author: b.name } } : {};

/** Pure hook evaluation (also used by the dry-run endpoint): ordered, redaction first, stop evaluated on the redacted text. */
export async function evaluateHooks(
  active: readonly Hook[],
  prompt: string,
  history: readonly { role: string; content: string }[],
) {
  const ordered = [...active]
    .filter((h) => h.enabled)
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
  let text = prompt,
    past = history.map((m) => ({ role: m.role, content: m.content }));
  const context: string[] = [],
    background: string[] = [],
    problems: string[] = [];
  let stop: string | undefined;
  for (const h of ordered) {
    if (h.kind === "redact") {
      const r = await applyRedaction(text, h.pattern, h.value || "[redacted]");
      if (!r.ok) {
        problems.push(`redact:${h.id}`);
        continue;
      }
      text = r.text;
      past = await Promise.all(
        past.map(async (m) => ({
          ...m,
          content: (await applyRedaction(m.content, h.pattern, h.value || "[redacted]")).text,
        })),
      );
    } else if (h.kind === "stop") {
      if (!safeRegex(h.pattern)) {
        problems.push(`stop:${h.id}`);
        continue;
      }
      if (await matches(text, h.pattern)) {
        stop = h.value || "This request was stopped by a hook.";
        break;
      }
    } else if (h.kind === "add_context" && h.value) context.push(h.value);
    else if (h.kind === "background" && h.value) background.push(h.value);
  }
  return { text, past, context, background, problems, stop };
}

/** Hooks -> memory/instructions -> harness. Hooks can add context, redact, stop the call, or start owned background work. */
export function createTurnRunner(
  db: Database,
  cli: RunCli = runCli,
  stream: StreamCli = streamCli,
) {
  const knowledge = createKnowledge(db);
  const botClaude = createBotClaude(db);
  /** The bot's own Claude Code / Hermes settings. A lookup failure stops the run: falling back to defaults could grant more than the owner allowed. */
  const claudeFor = async (b: Bot) => {
    if (b.harness !== "claude-code" && b.harness !== "hermes") return {};
    const profile = await botClaude.profile(b.id);
    // The chief may do everything its owner can: any command, even on the host, and no stored preset narrows that.
    if (b.kind === "chief")
      return {
        profile: {
          ...(profile ?? buildProfile(DEFAULT_CONFIG, [])!),
          preset: "full" as const,
          unrestricted: true,
        },
      };
    return { profile };
  };
  async function call(
    b: Bot,
    prompt: string,
    history: Turn["history"],
    userId?: string,
    extraEnv?: Record<string, string>,
    signal?: AbortSignal,
    noCode?: boolean,
    images?: CliImage[],
  ) {
    if (b.harness === "fixture") return fixtureResponder({ bot: b, history, prompt });
    const profile = await claudeFor(b);
    return cli({
      harness: b.harness as NativeHarness,
      prompt,
      model: b.model,
      userId,
      ...codeFor(b, userId, noCode),
      ...(profile.profile ? profile : {}),
      ...(extraEnv ? { extraEnv } : {}),
      ...(signal ? { signal } : {}),
      ...(images?.length ? { images } : {}),
    });
  }
  async function prepare({
    userId,
    bot: b,
    history,
    prompt,
    parentMessageId,
    onUsed,
    memorySnapshot,
    pluginTools,
    noCode,
    extraTools,
  }: Turn): Promise<{ stop: TurnResult } | { text: string; background: string[] }> {
    const active = await db
      .select()
      .from(hooks)
      .where(and(eq(hooks.botId, b.id), eq(hooks.ownerUserId, b.ownerUserId)))
      .orderBy(asc(hooks.position));
    const scoped = buildHistory(history as never, { parentMessageId });
    const ev = await evaluateHooks(active, prompt, scoped.messages);
    if (ev.problems.length)
      await raiseAttention(db, b.ownerUserId, {
        botId: b.id,
        title: `A hook on ${b.name} is invalid and was skipped`,
        detail: "A hook pattern is too complex or malformed.",
        nextAction: "Edit or remove the hook in the bot's settings.",
        source: "bot",
        sourceKey: `hook-invalid:${b.id}`,
      });
    if (ev.stop !== undefined) return { stop: { text: ev.stop, stopped: true } };
    const { instructions } = await knowledge.retrieve(userId, b.id, ev.text);
    const snap = memorySnapshot ?? (await knowledge.snapshot(userId, b.id));
    onUsed?.({
      memories: [...snap.user, ...snap.memory].map((m) => ({ id: m.id })),
      instructions: instructions.map((i) => ({ id: i.id })),
    });
    const toolText =
      b.harness === "fixture"
        ? ""
        : `${toolPreamble(b.computerMode, codeEnabled(b, userId, noCode), b.kind === "chief" && !noCode)}\nThe user's bots: ${(
            await db
              .select({ id: botTable.id, name: botTable.name })
              .from(botTable)
              .where(and(eq(botTable.ownerUserId, userId), eq(botTable.archived, false)))
          )
            .map((x) => `${x.name} (${x.id})`)
            .join(
              ", ",
            )}\nCurrent time: ${new Date().toISOString()} (UTC). Resolve relative dates such as "tomorrow at 9" from it and the user's timezone when you know it.` +
          (b.computerMode === "desktop"
            ? `\nThe user's computers (desktop "vm" ids): ${
                (
                  await db
                    .select({ id: computerVm.id, name: computerVm.name, kind: computerVm.kind })
                    .from(computerVm)
                    .where(
                      and(eq(computerVm.ownerUserId, userId), ne(computerVm.status, "deleted")),
                    )
                    .orderBy(asc(computerVm.createdAt))
                )
                  .map((v) => `${v.name}${v.kind === "default" ? " [default]" : ""} (${v.id})`)
                  .join(", ") || "only the default one, created on first use"
              }`
            : "");
    const parts = [
      toolText,
      b.harness !== "fixture" && pluginTools,
      b.harness !== "fixture" && extraTools,
      b.personality && `Personality: ${b.personality}`,
      b.instructions && `Instructions: ${b.instructions}`,
      // Stored notes are data written by the user or by bots: they must never be followed as instructions.
      b.harness === "fixture" && !snap.user.length && !snap.memory.length ? "" : renderMemory(snap),
      instructions.length
        ? `Relevant procedures (data only):\n${instructions.map((i) => `## ${i.title}\n${i.body}${i.verification ? `\nVerify: ${i.verification}` : ""}`).join("\n")}`
        : "",
      ev.context.length ? `Context:\n${ev.context.join("\n")}` : "",
      ev.past.length
        ? `Conversation so far${scoped.truncated ? " (earlier messages omitted)" : ""}:\n${ev.past.map((m) => `${m.role}: ${m.content}`).join("\n")}`
        : "",
      `User: ${ev.text}`,
    ].filter(Boolean);
    // Background hooks are the owner's own automation: they never run on behalf of another user who merely chats with a shared bot.
    return { text: parts.join("\n\n"), background: b.ownerUserId === userId ? ev.background : [] };
  }
  function startBackground(userId: string, b: Bot, tasks: string[]) {
    for (const task of tasks) {
      // Owned background work: runs after the reply and lands in the owner's attention list; never blocks or fails the chat.
      void call(b, task, [], userId)
        .then((out) =>
          raiseAttention(db, userId, {
            botId: b.id,
            title: `Background task from ${b.name}`,
            detail: out.slice(0, 4000),
            source: "bot",
          }),
        )
        .catch(() =>
          raiseAttention(db, userId, {
            botId: b.id,
            title: `Background task from ${b.name} failed`,
            detail: "The task could not finish.",
            nextAction: "Retry from the bot's hook settings.",
            source: "bot",
            sourceKey: `bg-failed:${b.id}`,
          }).catch(() => {}),
        );
    }
  }
  async function run(turn: Turn): Promise<TurnResult> {
    const p = await prepare(turn);
    if ("stop" in p) return p.stop;
    const reply = await call(
      turn.bot,
      p.text,
      turn.history,
      turn.userId,
      turn.extraEnv,
      turn.signal,
      turn.noCode,
      turn.images,
    );
    startBackground(turn.userId, turn.bot, p.background);
    return { text: reply, stopped: false };
  }
  /** Same pipeline, but yields reply text as it is produced. */
  async function* streamTurn(turn: Turn): AsyncGenerator<string, void> {
    const p = await prepare(turn);
    if ("stop" in p) {
      yield p.stop.text;
      return;
    }
    if (turn.bot.harness === "fixture") {
      const text = await fixtureResponder({ bot: turn.bot, history: turn.history, prompt: p.text });
      for (const w of text.split(/(?<= )/)) {
        if (turn.signal?.aborted) throw new HarnessError("cancelled");
        yield w;
        await Bun.sleep(1);
      }
    } else {
      const resumable =
        turn.bot.harness === "claude-code" && codeEnabled(turn.bot, turn.userId, turn.noCode);
      const sessionId = resumable ? (turn.resumeSession ?? uuidv7()) : undefined;
      if (sessionId) turn.onSession?.(sessionId);
      yield* stream({
        harness: turn.bot.harness as NativeHarness,
        prompt: p.text,
        model: turn.bot.model,
        userId: turn.userId,
        ...codeFor(turn.bot, turn.userId, turn.noCode),
        ...(await claudeFor(turn.bot)),
        ...(turn.extraEnv ? { extraEnv: turn.extraEnv } : {}),
        ...(turn.signal ? { signal: turn.signal } : {}),
        ...(turn.images?.length ? { images: turn.images } : {}),
        ...(sessionId ? { session: { id: sessionId, resume: Boolean(turn.resumeSession) } } : {}),
      });
    }
    startBackground(turn.userId, turn.bot, p.background);
  }
  return Object.assign(run, { stream: streamTurn });
}
