import { HarnessError } from "./harness";

/** How a failed run should be treated: wait and retry, wait longer (limit resets), or stop and ask a person. */
export type FailureKind = "transient" | "quota" | "needs_person";

export function failureKind(code: string | null | undefined): FailureKind {
  if (code === "quota") return "quota";
  if (code === "auth_required" || code === "not_installed" || code === "owner_inactive")
    return "needs_person";
  return "transient";
}

const MIN = 60_000;
const TRANSIENT_MS = [30_000, MIN, 2 * MIN, 4 * MIN, 8 * MIN, 16 * MIN];
const TRANSIENT_MAX_ATTEMPTS = 10;
const QUOTA_MS = [15 * MIN, 30 * MIN];
const QUOTA_STEADY_MS = 60 * MIN;
const QUOTA_MAX_WAIT_MS = 24 * 60 * MIN;

/** Waiting time before retry number `attempt` (1 = the first retry), or null when a person must step in. */
export function retryDelayMs(kind: FailureKind, attempt: number): number | null {
  if (kind === "needs_person") return null;
  if (kind === "transient") {
    if (attempt > TRANSIENT_MAX_ATTEMPTS) return null;
    return TRANSIENT_MS[attempt - 1] ?? 30 * MIN;
  }
  let waited = 0;
  for (let i = 1; i <= attempt; i++) {
    waited += QUOTA_MS[i - 1] ?? QUOTA_STEADY_MS;
    if (waited > QUOTA_MAX_WAIT_MS) return null;
  }
  return QUOTA_MS[attempt - 1] ?? QUOTA_STEADY_MS;
}

/** Short in-turn retries for one CLI call, before the turn is reported as failed. */
export const TURN_RETRY_MS = [2_000, 10_000];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** True for a harness failure that a short wait can fix (not a cancel, a sign-in or a quota). */
export const isTransient = (e: unknown) =>
  e instanceof HarnessError && e.code !== "cancelled" && failureKind(e.code) === "transient";

/** Runs `fn`, retrying after each delay only when it throws a transient HarnessError. Stops at once on abort. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  o: { delays: readonly number[]; signal?: AbortSignal | undefined },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const delay = o.delays[attempt];
      if (delay === undefined || !isTransient(e) || o.signal?.aborted) throw e;
      await sleep(delay, o.signal);
      if (o.signal?.aborted) throw e;
    }
  }
}
