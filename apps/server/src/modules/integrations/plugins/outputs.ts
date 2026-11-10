import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { codeDir } from "../../chat/harness";

/**
 * Where a plugin keeps a file it produced (speech audio, an export): the person's code folder under `outputs/<plugin>/`, which their
 * bots with code access read and the person can open. Returns the path relative to that folder.
 */
export async function saveOutput(userId: string, plugin: string, name: string, bytes: Uint8Array) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "output";
  const rel = join("outputs", plugin, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safe}`);
  const abs = join(codeDir(userId), rel);
  await mkdir(join(abs, ".."), { recursive: true, mode: 0o700 });
  await writeFile(abs, bytes, { mode: 0o600 });
  return rel;
}
