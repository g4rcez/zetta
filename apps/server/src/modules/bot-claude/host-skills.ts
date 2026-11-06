import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginFile } from "../chat/harness";
import { FILE_LIMITS, LIMITS, noInjection, skillName } from "./profile";

/**
 * Skills that sit in the home of the user running the server. `claude` (~/.claude/skills) is read by Claude Code on its own;
 * `agents` (~/.agents/skills) is the folder other agent tools share, which Claude Code does not read.
 * Off unless ZETTA_HOST_SKILLS=on: the folders belong to one OS user, and every person who can chat with a bot would see them.
 */
export type HostRoot = "claude" | "agents";
/** `dir` is the absolute folder of the skill. The text of the skill is never kept here: the harness loads the skill itself. */
export type HostSkill = { name: string; description: string; root: HostRoot; dir: string };
type Options = { home?: string; env?: NodeJS.ProcessEnv };

const ROOTS: readonly (readonly [HostRoot, string])[] = [
  ["claude", ".claude/skills"],
  ["agents", ".agents/skills"],
];
const MAX_PER_ROOT = 200;

const unquote = (v: string) => v.replace(/^(["'])(.*)\1$/, "$2");
/** One frontmatter value. A folded or literal block (`>`, `|`) or an empty value takes the indented lines below it. */
export function field(head: string, key: string) {
  const lines = head.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return "";
  let value = lines[at]!.slice(key.length + 1).trim();
  if (value === "" || /^[>|][+-]?$/.test(value)) {
    value = "";
    for (const l of lines.slice(at + 1)) {
      if (l.trim() && !/^\s/.test(l)) break;
      value += ` ${l.trim()}`;
    }
  }
  return unquote(value.trim()).replace(/\s+/g, " ").trim();
}

/** A SKILL.md as a skill, or undefined when it cannot be used: empty, too long, or with shell injection (!`cmd`) in the text. */
export function parseSkillFile(text: string): { description: string; body: string } | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  const body = (m ? m[2]! : text).trim();
  if (!body || body.length > LIMITS.body || !noInjection(body)) return undefined;
  const description = field(m?.[1] ?? "", "description") || (body.split(/\r?\n/)[0] ?? "");
  return { description: description.slice(0, LIMITS.description), body };
}

/**
 * The skills in the home folders, `claude` first: a name found in both is listed once, from the folder Claude Code reads.
 * Nothing when the feature is off. A folder that is missing, a name that is not a valid skill name and a file that cannot be read are skipped.
 */
export async function hostSkills({ env = process.env, ...rest }: Options = {}): Promise<
  HostSkill[]
> {
  if (env.ZETTA_HOST_SKILLS !== "on") return [];
  // The same HOME the harness hands to the CLI.
  const home = rest.home ?? (env.HOME || homedir());
  const seen = new Set<string>();
  const out: HostSkill[] = [];
  for (const [root, dir] of ROOTS) {
    const entries = await readdir(join(home, dir), { withFileTypes: true }).catch(() => []);
    const found = await Promise.all(
      entries
        .filter(
          (e) => (e.isDirectory() || e.isSymbolicLink()) && skillName.safeParse(e.name).success,
        )
        .sort((x, y) => x.name.localeCompare(y.name))
        .slice(0, MAX_PER_ROOT)
        .map(async (e) => {
          const text = await readFile(join(home, dir, e.name, "SKILL.md"), "utf8").catch(
            () => undefined,
          );
          const skill = text === undefined ? undefined : parseSkillFile(text);
          return (
            skill &&
            ({
              name: e.name,
              root,
              description: skill.description,
              dir: join(home, dir, e.name),
            } satisfies HostSkill)
          );
        }),
    );
    for (const k of found)
      if (k && !seen.has(k.name)) {
        seen.add(k.name);
        out.push(k);
      }
  }
  return out;
}
export async function hostSkill(name: string, options?: Options) {
  return (await hostSkills(options)).find((k) => k.name === name);
}

/**
 * The skill as files for a run's plugin dir (see `writePluginDir`), so Claude Code installs it and loads it with the Skill tool.
 * The whole folder goes along (scripts, references, assets). Symlinks are not followed, and a folder over FILE_LIMITS
 * sends its SKILL.md only, because some of its files would be missing anyway.
 */
export async function hostSkillFiles(skill: HostSkill): Promise<Record<string, PluginFile>> {
  const base = `skills/${skill.name}`;
  const other: Record<string, PluginFile> = {};
  let count = 0;
  let total = 0;
  let tooMuch = false;
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(skill.dir, rel), { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (tooMuch || e.name === "node_modules" || e.name === ".git") continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path);
      else if (e.isFile() && path.toLowerCase() !== "skill.md") {
        const full = join(skill.dir, path);
        const info = await stat(full);
        count++;
        total += info.size;
        if (info.size > FILE_LIMITS.file || count > FILE_LIMITS.count || total > FILE_LIMITS.total)
          tooMuch = true;
        else
          other[`${base}/${path}`] = {
            bytes: await readFile(full),
            mode: info.mode & 0o111 ? "executable" : "file",
          };
      }
    }
  };
  await walk("").catch(() => {
    tooMuch = true;
  });
  return {
    [`${base}/SKILL.md`]: await readFile(join(skill.dir, "SKILL.md"), "utf8"),
    ...(tooMuch ? {} : other),
  };
}
