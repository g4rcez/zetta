import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Commands that always ask the person at this computer, whatever they allowed before: deletes, root and mail. */
const GUARDED = [
  "rm",
  "rmdir",
  "shred",
  "unlink",
  "sudo",
  "mail",
  "sendmail",
  "del",
  "rd",
  "format",
  "diskpart",
] as const;

/** The guarded commands a command line names, anywhere in it (after `;`, `&&`, `|`, `$(`, a path or `sudo`). Best effort, like a shell rule. */
export function guardedWords(command: string): string[] {
  return GUARDED.filter((word) => new RegExp(`(^|[^\\w.-])${word}(?![\\w.-])`, "i").test(command));
}

export type Decision = "once" | "always" | "deny";

/**
 * What the person at this computer allowed, per remote server and per bot: `always` lets that bot run ordinary commands without asking.
 * It never covers a guarded command (see `guardedWords`). A file that cannot be read is moved aside and everything asks again.
 */
export function createGrants(file: string, now: () => number = Date.now) {
  let grants: Record<string, Record<string, "always">> = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { grants?: unknown };
      if (!parsed.grants || typeof parsed.grants !== "object") throw new Error("no grants");
      for (const [serverId, bots] of Object.entries(parsed.grants as Record<string, unknown>)) {
        if (!bots || typeof bots !== "object") continue;
        for (const [botId, value] of Object.entries(bots as Record<string, unknown>))
          if (value === "always") (grants[serverId] ??= {})[botId] = "always";
      }
    } catch {
      renameSync(file, `${file}.unreadable-${now()}`);
      grants = {};
    }
  }
  const save = () => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, grants }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  };
  return {
    allows: (serverId: string, botId: string) => grants[serverId]?.[botId] === "always",
    allow(serverId: string, botId: string) {
      (grants[serverId] ??= {})[botId] = "always";
      save();
    },
    revoke(serverId: string, botId: string) {
      if (!grants[serverId]?.[botId]) return false;
      delete grants[serverId]![botId];
      save();
      return true;
    },
    /** Everything given to the bots of one server (it was disconnected or stopped sharing). */
    revokeServer(serverId: string) {
      if (!grants[serverId]) return;
      delete grants[serverId];
      save();
    },
    list: () =>
      Object.entries(grants).flatMap(([serverId, bots]) =>
        Object.keys(bots).map((botId) => ({ serverId, botId })),
      ),
  };
}
export type Grants = ReturnType<typeof createGrants>;
