import { tmpdir } from "node:os";
import { PluginError } from "../registry";

/**
 * Runs a password-manager CLI (`op`, `bw`, `bws`). Secrets travel ONLY in `env` (never argv, which other local users can read in the
 * process list); the child gets PATH/HOME plus that env, a neutral working directory, no stdin, a deadline and a bounded output.
 * Output is never logged or put in an error: callers parse it and keep only metadata or the one value they need.
 */
export type VaultExec = (
  argv: string[],
  env: Record<string, string>,
) => Promise<{ code: number; stdout: string; stderr: string }>;
const TIMEOUT_MS = 30_000,
  MAX_OUT = 8_000_000;

export const spawnExec: VaultExec = async (argv, env) => {
  let p: ReturnType<typeof Bun.spawn>;
  try {
    p = Bun.spawn(argv, {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }
  const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout as ReadableStream).text(),
      new Response(p.stderr as ReadableStream).text(),
      p.exited,
    ]);
    if (stdout.length > MAX_OUT)
      throw new PluginError("TOO_LARGE", "The password manager answered with too much data.");
    return { code, stdout, stderr: stderr.slice(0, 4000) };
  } finally {
    clearTimeout(timer);
  }
};

let current: VaultExec = spawnExec;
let currentFetch: typeof fetch = fetch;
let policy = { allowPrivate: false };
/** Test hook and platform policy: a fake CLI runner / fetch, and the same private-address switch the MCP service uses (for 1Password Connect). */
export const configureVault = (o: {
  exec?: VaultExec;
  fetch?: typeof fetch;
  allowPrivate?: boolean;
}) => {
  if (o.exec) current = o.exec;
  if (o.fetch) currentFetch = o.fetch;
  if (o.allowPrivate !== undefined) policy = { allowPrivate: o.allowPrivate };
};
export const vaultPolicy = () => policy;
export const vaultFetch: typeof fetch = ((...a: Parameters<typeof fetch>) =>
  currentFetch(...a)) as typeof fetch;

/** Runs a CLI; a missing binary becomes a clear error for the user/administrator. */
export async function run(bin: string, label: string, argv: string[], env: Record<string, string>) {
  try {
    return await current([bin, ...argv], env);
  } catch (e) {
    if (e instanceof PluginError) throw e;
    if ((e as { code?: string }).code === "ENOENT")
      throw new PluginError(
        "CLI_MISSING",
        `The ${label} command (${bin}) is not installed on the Zetta server.`,
        `Ask the administrator to install ${bin} on the server (see docs/decisions/credential-vaults.md).`,
      );
    throw new PluginError("UNREACHABLE", `The ${label} command could not be run.`);
  }
}

/** Parses CLI JSON output; anything unexpected is a generic error (the output may contain secrets, so it is never echoed). */
export function json<T>(stdout: string, label: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new PluginError(
      "VAULT_ERROR",
      `${label} answered with something unexpected.`,
      "Try again in a moment.",
    );
  }
}

/** Strip control/bidi characters and cap length (titles and URLs come from the user's vault but are shown to bots). */
// oxlint-disable-next-line no-control-regex
export const clean = (v: unknown, max: number) =>
  String(v ?? "")
    // oxlint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, " ")
    .trim()
    .slice(0, max);
/** Vault ids go into argv: never let one look like a flag or carry shell-ish characters. */
export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
