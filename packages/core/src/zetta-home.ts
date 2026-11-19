import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

// Where this installation keeps its state on disk. Server-side only (it reads the process environment and the home folder).

type Env = Record<string, string | undefined>;

/** Zetta's local state folder: `ZETTA_HOME`, or `~/.zetta`. */
export const zettaHome = (env: Env = process.env) =>
  env.ZETTA_HOME?.trim() || join(homedir(), ".zetta");

/** `ZETTA_HOME` is set: the installation is isolated, so no state may live outside that folder. */
export const isIsolated = (env: Env = process.env) => Boolean(env.ZETTA_HOME?.trim());

/**
 * The folder for one kind of state (`artifacts`, `code`, `cache/models`...).
 * With `ZETTA_HOME` set it is always inside it. Without, it is `legacy` (what each place used before this helper existed, so an existing
 * install finds its files where they are), or `~/.zetta/<name>`.
 */
export function dataDir(name: string, legacy?: string, env: Env = process.env): string {
  if (isIsolated(env)) return join(zettaHome(env), name);
  return legacy ?? join(homedir(), ".zetta", name);
}

/** A short, stable name for this installation, derived from its state folder: two installs with different `ZETTA_HOME` never share it. */
export const installTag = (env: Env = process.env) =>
  createHash("sha256").update(zettaHome(env)).digest("hex").slice(0, 8);

/**
 * The name prefix of the containers one feature starts (`run`, `browser`, `playground`). Unchanged (`zetta-run-`) for an install without
 * `ZETTA_HOME`; `zetta-<tag>-run-` for an isolated one, so a boot sweep removes only its own containers and never another install's.
 */
export const containerPrefix = (kind: string, env: Env = process.env) =>
  isIsolated(env) ? `zetta-${installTag(env)}-${kind}-` : `zetta-${kind}-`;
