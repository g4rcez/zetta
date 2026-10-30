import type { AdminOperatorTarget } from "@zetta/db/admin-operator-client";
import type { createAdminLifecycleService } from "./admin-lifecycle";

type Action = "bootstrap" | "replace";
type Command =
  | { action: "bootstrap"; input: { userId: string } }
  | {
      action: "replace";
      input: {
        expectedAdminUserId: string;
        newAdminUserId: string;
        reason: "admin-unavailable" | "planned-transfer";
      };
    };
type Phase = "configuration" | "input" | "connection" | "operation" | "cleanup" | "deadline";
type OperatorEnvironment = Readonly<Record<string, string | undefined>>;
export type OperatorDependencies = {
  isTTY(): boolean;
  readInput(signal: AbortSignal): Promise<string>;
  startDeadline(expired: () => void): () => void;
  terminate(): void;
  open(target: AdminOperatorTarget): Promise<{
    service: ReturnType<typeof createAdminLifecycleService>;
    healthy(): void;
    close(): Promise<void>;
  }>;
  stdout(text: string): void;
  stderr(text: string): void;
};

const maximumInputBytes = 4096;
const usage =
  "Usage: admin-operator-cli.ts bootstrap | replace\nRead one bounded JSON object from non-TTY stdin. See docs/operations/identity-admin.md.\n";
function failure(phase: Phase) {
  return `Admin operator unavailable (${phase}).\n`;
}
function deny(phase: Phase): never {
  throw new Error(failure(phase).trimEnd());
}
// oxlint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f-\u009f]/;
function exactId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value && !controls.test(value)
  );
}
function component(raw: string): string {
  const value = decodeURIComponent(raw);
  // Canonical encoding only: no double escapes, encoded separators or dot paths.
  if (
    !exactId(value) ||
    /[%/\\]/.test(value) ||
    value === "." ||
    value === ".." ||
    encodeURIComponent(value) !== raw
  )
    deny("configuration");
  return value;
}

/** Pure pre-driver guard. OS/DB access is authority; acknowledgement is not authentication. */
export function requireOperatorTarget(env: OperatorEnvironment): AdminOperatorTarget {
  try {
    if (
      env.ZETTA_OPERATOR_ALLOW_MUTATION !== "identity-admin" ||
      Object.keys(env).some((key) => /^PG/i.test(key) || key === "NODE_PG_FORCE_NATIVE")
    )
      deny("configuration");
    const raw = env.ZETTA_OPERATOR_DATABASE_URL;
    if (typeof raw !== "string" || controls.test(raw)) deny("configuration");
    const match =
      /^(postgres|postgresql):\/\/([^:@/?#\\\s]+):([^@/?#\\\s]+)@(localhost|127\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})|\[::1\])(?::([1-9][0-9]{0,4}))?\/([^/?#\\\s]+)$/.exec(
        raw,
      );
    if (!match || match[0] !== raw) deny("configuration");
    const host = match[4]!;
    if (host.startsWith("127.") && host.split(".").some((part) => Number(part) > 255))
      deny("configuration");
    const port = match[5] === undefined ? 5432 : Number(match[5]);
    if (port > 65535) deny("configuration");
    const user = component(match[2]!);
    const password = component(match[3]!);
    const database = component(match[6]!);
    const parsed = new URL(raw);
    if (
      parsed.hostname !== host ||
      parsed.pathname !== `/${match[6]}` ||
      parsed.username !== match[2] ||
      parsed.password !== match[3]
    )
      deny("configuration");
    return Object.freeze({ host: host === "[::1]" ? "::1" : host, port, database, user, password });
  } catch {
    return deny("configuration");
  }
}

export function parseOperatorInput(action: Action, text: string): Command {
  try {
    if (new TextEncoder().encode(text).byteLength > maximumInputBytes) deny("input");
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) deny("input");
    const fields = value as Record<string, unknown>;
    const keys =
      action === "bootstrap" ? ["userId"] : ["expectedAdminUserId", "newAdminUserId", "reason"];
    if (
      Object.keys(fields).length !== keys.length ||
      Object.keys(fields).some((key) => !keys.includes(key))
    )
      deny("input");
    if (action === "bootstrap") {
      if (!exactId(fields.userId)) deny("input");
      return { action, input: { userId: fields.userId } };
    }
    if (
      !exactId(fields.expectedAdminUserId) ||
      !exactId(fields.newAdminUserId) ||
      fields.expectedAdminUserId === fields.newAdminUserId ||
      (fields.reason !== "admin-unavailable" && fields.reason !== "planned-transfer")
    )
      deny("input");
    return {
      action,
      input: {
        expectedAdminUserId: fields.expectedAdminUserId,
        newAdminUserId: fields.newAdminUserId,
        reason: fields.reason,
      },
    };
  } catch {
    return deny("input");
  }
}

/** Bytes are bounded before decoding; fatal streaming decoding retains split UTF-8. */
export async function readOperatorInput(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  let complete = false;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let size = 0,
      text = "";
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumInputBytes) deny("input");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    complete = true;
    return text;
  } catch {
    return deny("input");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

/** Single attempt; service resolution means commit, not rollback on a later failure. */
export async function runAdminOperator(
  args: readonly string[],
  env: OperatorEnvironment,
  deps: OperatorDependencies,
): Promise<0 | 1> {
  let phase: Phase = "configuration";
  let target: AdminOperatorTarget;
  let action: Action;
  try {
    if (args.length === 1 && args[0] === "--help") {
      deps.stdout(usage);
      return 0;
    }
    if (args.length !== 1 || (args[0] !== "bootstrap" && args[0] !== "replace")) deny(phase);
    action = args[0];
    target = requireOperatorTarget(env);
    if (deps.isTTY()) deny(phase);
  } catch {
    deps.stderr(failure(phase));
    return 1;
  }

  const abort = new AbortController();
  let expired = false;
  const stopDeadline = deps.startDeadline(() => {
    expired = true;
    abort.abort();
    deps.stderr(failure("deadline"));
    // Actual CLI exits immediately, even if stdin, driver or cleanup never settles.
    deps.terminate();
  });
  let owned: Awaited<ReturnType<OperatorDependencies["open"]>> | undefined;
  let failed = false;
  try {
    phase = "input";
    const command = parseOperatorInput(action, await deps.readInput(abort.signal));
    abort.signal.throwIfAborted();
    phase = "connection";
    owned = await deps.open(target);
    abort.signal.throwIfAborted();
    phase = "operation";
    if (command.action === "bootstrap") await owned.service.bootstrapExistingAccount(command.input);
    else await owned.service.replaceAdminWithExistingAccount(command.input);
    owned.healthy();
  } catch {
    failed = true;
  } finally {
    if (owned) {
      try {
        await owned.close();
        owned.healthy();
      } catch {
        if (!failed) phase = "cleanup";
        failed = true;
      }
    }
    stopDeadline();
  }
  if (expired) return 1;
  if (failed) {
    deps.stderr(failure(phase));
    return 1;
  }
  deps.stdout("Admin operator completed.\n");
  return 0;
}
