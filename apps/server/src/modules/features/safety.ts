import { createHash } from "node:crypto";

const MAX_PATTERN = 100;
const MAX_INPUT = 20_000;
const TIMEOUT_MS = 150;
/** First line of defence: reject shapes that are classically catastrophic. The worker timeout below is the real guarantee. */
const RISKY = [
  /\([^)]*[+*{][^)]*\)[+*{]/,
  /\([^)]*\|[^)]*\)[+*{]/,
  /\\[1-9]/,
  /\(\?[=!<]/,
  /\([^()]*\([^()]*[+*{?]/,
  /(\.\*|\.\+|[+*]\??){3,}/,
];

/** Returns a RegExp for validation only (never executed on user text in this process), or undefined when invalid or risky. */
export function safeRegex(pattern: string): RegExp | undefined {
  if (!pattern || pattern.length > MAX_PATTERN || RISKY.some((r) => r.test(pattern)))
    return undefined;
  try {
    return new RegExp(pattern, "gi");
  } catch {
    return undefined;
  }
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (r: { ok: boolean; value?: unknown }) => void>();
const killed = new Set<string>(); // patterns that already timed out: never run again
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./regex-worker.ts", import.meta.url));
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown }>) => {
    pending.get(e.data.id)?.(e.data);
    pending.delete(e.data.id);
  };
  worker.onerror = () => {
    for (const f of pending.values()) f({ ok: false });
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}
/** Runs the regex in a worker with a hard timeout; on timeout the worker is killed and the pattern is blacklisted for this process. */
function inWorker(
  op: "replace" | "test",
  pattern: string,
  text: string,
  replacement?: string,
): Promise<{ ok: boolean; value?: unknown }> {
  if (killed.has(pattern)) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      killed.add(pattern);
      worker?.terminate();
      worker = undefined;
      for (const f of pending.values()) f({ ok: false });
      pending.clear();
      resolve({ ok: false });
    }, TIMEOUT_MS);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    ensureWorker().postMessage({ id, op, pattern, text: text.slice(0, MAX_INPUT), replacement });
  });
}
export async function applyRedaction(text: string, pattern: string, replacement: string) {
  if (!safeRegex(pattern)) return { text, ok: false as const };
  const r = await inWorker("replace", pattern, text, replacement);
  return r.ok
    ? {
        text: (r.value as string) + (text.length > MAX_INPUT ? text.slice(MAX_INPUT) : ""),
        ok: true as const,
      }
    : { text, ok: false as const };
}
export async function matches(text: string, pattern: string) {
  if (!safeRegex(pattern)) return false;
  const r = await inWorker("test", pattern, text);
  return r.ok && r.value === true;
}

export { looksSecret } from "@zetta/core/secrets";
export const contentHash = (...parts: string[]) =>
  createHash("sha256")
    .update(parts.map((p) => p.trim().toLowerCase().replace(/\s+/g, " ")).join("\u0000"))
    .digest("hex");
export const configHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
