import type { bot } from "@zetta/db/schema/chat";
import type { CliProgress } from "./claude-stream";
import { HarnessError, type HarnessErrorCode } from "./harness";
import { HARNESS_LABELS } from "./harnesses";

type Bot = typeof bot.$inferSelect;

/** Failures that mean "this harness cannot answer now" (limit reached, not signed in, not installed). Slow or flaky runs are not here: they keep their retries. */
const BLOCKED: readonly HarnessErrorCode[] = ["quota", "auth_required", "not_installed"];
export const blocksHarness = (e: unknown): e is HarnessError =>
  e instanceof HarnessError && BLOCKED.includes(e.code);

/** What a turn reports when it moved to the fallback harness: the harness names are stable keys, the reason is the error code. */
export type FallbackUse = { from: string; to: string; reason: HarnessErrorCode };

/** The bot as it runs on its fallback harness, or null when it has none. The fallback has its own model: the main one rarely exists there. */
export const fallbackOf = (b: Bot): Bot | null =>
  b.fallbackHarness && b.fallbackHarness !== b.harness
    ? { ...b, harness: b.fallbackHarness, model: b.fallbackModel }
    : null;

const label = (h: string) => HARNESS_LABELS[h as keyof typeof HARNESS_LABELS] ?? h;
const REASON: Record<string, string> = {
  quota: "has reached its usage limit",
  auth_required: "is not signed in",
  not_installed: "is not installed",
};
const notice = (u: FallbackUse) =>
  `${label(u.from)} ${REASON[u.reason]} · answering with ${label(u.to)}`;

/** Runs `attempt` for the bot; when its harness is blocked, runs it once for the fallback bot. A failure of the fallback is thrown as it is. */
export async function runWithFallback<T>(
  b: Bot,
  attempt: (b: Bot) => Promise<T>,
  onFallback?: (use: FallbackUse) => void,
): Promise<T> {
  try {
    return await attempt(b);
  } catch (e) {
    const next = fallbackOf(b);
    if (!next || !blocksHarness(e)) throw e;
    onFallback?.({ from: b.harness, to: next.harness, reason: e.code });
    return attempt(next);
  }
}

/**
 * Streaming form. The fallback starts only while nothing of the reply has reached the person: after that a second answer would repeat
 * or contradict the first. It tells the person with one progress line.
 */
export async function* streamWithFallback(
  b: Bot,
  start: (b: Bot) => AsyncGenerator<string | CliProgress, void>,
  onFallback?: (use: FallbackUse) => void,
): AsyncGenerator<string | CliProgress, void> {
  let replied = false;
  try {
    for await (const item of start(b)) {
      if (typeof item === "string" && item.trim()) replied = true;
      yield item;
    }
  } catch (e) {
    const next = fallbackOf(b);
    if (replied || !next || !blocksHarness(e)) throw e;
    const use: FallbackUse = { from: b.harness, to: next.harness, reason: e.code };
    onFallback?.(use);
    yield { activity: notice(use) };
    yield* start(next);
  }
}
