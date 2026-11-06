import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { DENIED } from "../chat/files";
import { ComputerError } from "./service";

/**
 * What a bot may ask of a machine, checked before the call. The same rules as the bot's own shell: deletes, root and mail wait for
 * the user (each is lifted by exactly one rule in the bot's approved allow list), and files move only inside the user's workspace.
 */
const GUARDED = ["rm", "rmdir", "shred", "unlink", "sudo", "mail", "sendmail"] as const;

/** The guarded commands a remote command line names, anywhere in it (after `;`, `&&`, `|`, `$(`, a path or `sudo`). Best effort, like the shell rules. */
export function guardedWords(command: string): string[] {
  return GUARDED.filter((w) => new RegExp(`(^|[^\\w.-])${w}(?![\\w.-])`).test(command));
}
export const ruleOf = (word: string) => `Bash(${word}:*)`;

/**
 * A path in the user's workspace folder for a transfer. A relative path is taken from the folder; `..`, absolute paths elsewhere,
 * symlinks that leave the folder and credential-looking names are refused. `read` needs the file to exist; `write` creates the
 * folders above it.
 */
export async function workspacePath(
  base: string,
  path: string,
  mode: "read" | "write",
): Promise<string> {
  // A backslash is refused in a relative path on every system. In a Windows absolute path it is the separator.
  if (
    !path ||
    path.length > 500 ||
    // oxlint-disable-next-line no-control-regex
    /[\u0000-\u001f]/.test(path) ||
    (path.includes("\\") && !(sep === "\\" && isAbsolute(path)))
  )
    throw new ComputerError("INVALID");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await realpath(base);
  const target = resolve(root, path);
  if (!target.startsWith(root + sep) || DENIED.test(target.slice(root.length)))
    throw new ComputerError("INVALID");
  // The deepest part that exists must really be inside the folder, so a symlink cannot lead out of it.
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== root && !real.startsWith(root + sep)) throw new ComputerError("INVALID");
      if (probe === target) {
        if (DENIED.test(real.slice(root.length))) throw new ComputerError("INVALID");
        return real;
      }
      break;
    } catch (e) {
      if (e instanceof ComputerError) throw e;
      const up = dirname(probe);
      if (up === probe) throw new ComputerError("INVALID");
      probe = up;
    }
  }
  if (mode === "read") throw new ComputerError("NOT_FOUND");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  return target;
}
