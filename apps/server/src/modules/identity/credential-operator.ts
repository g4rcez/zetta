import type { OperatorCredentials, OperatorProvisioningResult } from "@zetta/auth/operator-provisioning";
import { z } from "zod";
import { requireOperatorTarget } from "./admin-operator";
import type { OperatorDependencies } from "./admin-operator";

type Action = "bootstrap" | "replace";
type Phase = "configuration" | "input" | "connection" | "provisioning" | "activation" | "cleanup" | "deadline";
export type CredentialOperatorDependencies = Omit<OperatorDependencies, "open"> & Readonly<{
  open(target: Parameters<OperatorDependencies["open"]>[0]): Promise<Awaited<ReturnType<OperatorDependencies["open"]>> & Readonly<{
    provision(input: OperatorCredentials): Promise<OperatorProvisioningResult>;
  }>>;
}>;
const credentials = z.strictObject({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});
const replacement = credentials.extend({
  expectedAdminUserId: z.string().min(1).refine((value) => value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value)),
  reason: z.enum(["admin-unavailable", "planned-transfer"]),
});
function failure(phase: Phase) { return `Credential operator unavailable (${phase}).\n`; }
class CredentialOperatorUnavailable extends Error {
  constructor(phase: Phase) { super(failure(phase).trimEnd()); }
}
export function parseCredentialOperatorInput(action: Action, text: string) {
  try {
    if (new TextEncoder().encode(text).byteLength > 4096) throw new CredentialOperatorUnavailable("input");
    const input: unknown = JSON.parse(text);
    switch (action) {
      case "bootstrap": return { action, input: credentials.parse(input) };
      case "replace": return { action, input: replacement.parse(input) };
    }
  } catch { // no-excuse-ok: catch -- input boundary never exposes submitted credentials.
    throw new CredentialOperatorUnavailable("input");
  }
}

/** Two commits, one attempt: activation failure can leave an unentitled account. */
export async function runCredentialOperator(
  args: readonly string[], env: Readonly<Record<string, string | undefined>>, deps: CredentialOperatorDependencies,
): Promise<0 | 1> {
  let phase: Phase = "configuration";
  let target: ReturnType<typeof requireOperatorTarget>;
  let action: Action;
  try {
    if (args.length === 1 && args[0] === "--help") {
      deps.stdout("Usage: credential-operator-cli.ts bootstrap | replace\nRead one bounded JSON credential object from non-TTY stdin. See docs/operations/identity-admin.md.\n");
      return 0;
    }
    if (args.length !== 1 || (args[0] !== "bootstrap" && args[0] !== "replace")) throw new CredentialOperatorUnavailable(phase);
    action = args[0];
    if (Object.keys(env).some((key) => /^BETTER_AUTH_TELEMETRY/i.test(key))) throw new CredentialOperatorUnavailable(phase);
    target = requireOperatorTarget(env);
    if (deps.isTTY()) throw new CredentialOperatorUnavailable(phase);
  } catch { // no-excuse-ok: catch -- CLI boundary suppresses configuration details.
    deps.stderr(failure(phase)); return 1;
  }
  const abort = new AbortController();
  let expired = false;
  const stopDeadline = deps.startDeadline(() => {
    expired = true;
    abort.abort();
    deps.stderr(failure("deadline"));
    deps.terminate();
  });
  let owned: Awaited<ReturnType<CredentialOperatorDependencies["open"]>> | undefined;
  let failed = false;
  try {
    phase = "input";
    const command = parseCredentialOperatorInput(action, await deps.readInput(abort.signal));
    abort.signal.throwIfAborted();
    phase = "connection";
    owned = await deps.open(target);
    abort.signal.throwIfAborted();
    owned.healthy();
    phase = "provisioning";
    const { name, email, password } = command.input;
    const created = await owned.provision({ name, email, password });
    abort.signal.throwIfAborted();
    owned.healthy();
    if (!created.ok) throw new CredentialOperatorUnavailable(phase);
    phase = "activation";
    switch (command.action) {
      case "bootstrap": await owned.service.bootstrapExistingAccount({ userId: created.userId }); break;
      case "replace": await owned.service.replaceAdminWithExistingAccount({
        expectedAdminUserId: command.input.expectedAdminUserId, newAdminUserId: created.userId, reason: command.input.reason,
      }); break;
    }
    abort.signal.throwIfAborted();
    owned.healthy();
  } catch { // no-excuse-ok: catch -- no credential, returned ID or library cause leaves the boundary.
    failed = true;
  } finally {
    if (owned) {
      try { await owned.close(); owned.healthy(); }
      catch { // no-excuse-ok: catch -- preserve earlier failure phase without leaking driver causes.
        if (!failed) phase = "cleanup";
        failed = true;
      }
    }
    stopDeadline();
  }
  if (expired) return 1;
  if (failed) { deps.stderr(failure(phase)); return 1; }
  deps.stdout("Credential operator completed.\n");
  return 0;
}
