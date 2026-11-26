import { join } from "node:path";

import { codeDir } from "../../chat/harness";
import { writeInside } from "../../fs-inside";

/**
 * Where a plugin keeps a file it produced (speech audio, an export): the person's code folder under `outputs/<plugin>/`, which their
 * bots with code access read and the person can open. Returns the path relative to that folder.
 */
export async function saveOutput(userId: string, plugin: string, name: string, bytes: Uint8Array) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "output";
  const rel = join("outputs", plugin, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safe}`);
  // Bots write in the code folder: no link of theirs is followed.
  await writeInside(codeDir(userId), rel, bytes);
  return rel;
}
