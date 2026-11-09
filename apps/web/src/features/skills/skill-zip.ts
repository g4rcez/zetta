import { unzipSync, zipSync } from "fflate";

import { parseMarkdown } from "../claude/claude-api";
import { toSkillName } from "./skills-api";

/** The limits of a skill folder (apps/server/src/modules/bot-claude/profile.ts FILE_LIMITS): the server refuses more, this says so before sending. */
export const ZIP_LIMITS = {
  file: 1_000_000,
  count: 200,
  total: 4_000_000,
  skillMd: 70_000,
} as const;
export type ZipFile = { path: string; content: Uint8Array; mode: "file" | "executable" };

/** A skill as a folder: `<name>/SKILL.md` with its frontmatter, and the other files next to it. */
export function zipSkill(
  skill: { name: string; description: string; body: string },
  files: readonly ZipFile[],
): Uint8Array {
  const md = `---\nname: ${skill.name}\ndescription: ${skill.description.replace(/\s*\n\s*/g, " ")}\n---\n${skill.body}\n`;
  const entries: Record<string, Uint8Array> = {
    [`${skill.name}/SKILL.md`]: new TextEncoder().encode(md),
  };
  for (const f of files) entries[`${skill.name}/${f.path}`] = f.content;
  return zipSync(entries, { level: 6 });
}

export type UnzippedSkill = {
  name: string;
  description: string;
  body: string;
  files: ZipFile[];
};
export class ZipError extends Error {}

const JUNK = /(^|\/)(__MACOSX|\.git|node_modules)(\/|$)|(^|\/)\.DS_Store$/;
const SAFE = (path: string) =>
  path.length > 0 &&
  path.length <= 300 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  path.split("/").every((p) => p !== "" && p !== "." && p !== "..");

/**
 * Reads a skill folder from a zip: `SKILL.md` at the top or inside the one folder that holds everything. Anything that would be refused
 * later is refused here, with a sentence: too many files, too large, paths that leave the folder, no SKILL.md. Sizes are read from the
 * zip's index before anything is unpacked, so a zip bomb is stopped before it grows.
 */
export function unzipSkill(bytes: Uint8Array, fallbackName = "skill"): UnzippedSkill {
  let total = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith("/") || JUNK.test(file.name)) return false;
        count++;
        total += file.originalSize;
        if (count > ZIP_LIMITS.count + 1)
          throw new ZipError(`A skill folder has at most ${ZIP_LIMITS.count} files.`);
        if (file.originalSize > ZIP_LIMITS.file && !/(^|\/)SKILL\.md$/.test(file.name))
          throw new ZipError(`${file.name} is larger than 1 MB.`);
        if (total > ZIP_LIMITS.total + ZIP_LIMITS.skillMd)
          throw new ZipError("The folder is larger than 4 MB.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError("That is not a zip file.");
  }
  const paths = Object.keys(entries);
  const md = paths.filter((p) => p === "SKILL.md" || /^[^/]+\/SKILL\.md$/.test(p));
  if (md.length === 0)
    throw new ZipError("There is no SKILL.md at the top of the zip or in its one folder.");
  if (md.length > 1) throw new ZipError("The zip has more than one SKILL.md at the top.");
  const prefix = md[0] === "SKILL.md" ? "" : md[0]!.slice(0, md[0]!.indexOf("/") + 1);
  const files: ZipFile[] = [];
  for (const path of paths) {
    if (path === md[0]) continue;
    if (!path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    if (!SAFE(rel)) throw new ZipError(`"${path}" is not a path the skill can keep.`);
    const content = entries[path]!;
    files.push({
      path: rel,
      content,
      // A zip does not keep the executable bit in a way the browser can read: a script that starts with #! is one.
      mode: content[0] === 0x23 && content[1] === 0x21 ? "executable" : "file",
    });
  }
  const parsed = parseMarkdown(new TextDecoder().decode(entries[md[0]!]));
  const folder = prefix ? prefix.slice(0, -1) : fallbackName;
  return {
    name: toSkillName(parsed.name ?? folder),
    description: (parsed.description ?? "").trim(),
    body: parsed.body,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
