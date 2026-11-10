import { mkdir, readdir, readFile, realpath, stat, writeFile, appendFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { assertLocal } from "./local-only";
import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { optStr, str } from "./rest";

/**
 * Obsidian: the person's vault is a folder of Markdown notes, read and written in place (Obsidian picks up changes itself). Every path
 * stays inside the vault: `..`, absolute paths and symlinks that leave it are refused. Local installs only.
 */
const MAX_NOTE = 200_000;
const MAX_LIST = 500;

async function vault(c: PluginContext) {
  assertLocal("Obsidian");
  const raw = (c.config.vault ?? "").trim();
  if (!raw)
    throw new PluginError(
      "NOT_CONFIGURED",
      "No vault folder is set.",
      "Open the plugin and paste the vault's folder path.",
    );
  try {
    const real = await realpath(raw);
    if (!(await stat(real)).isDirectory()) throw 0;
    return real;
  } catch {
    throw new PluginError(
      "NOT_FOUND",
      "The vault folder does not exist.",
      "Check the path in the plugin settings.",
    );
  }
}

/** A note path inside the vault (".md" added when missing). Throws for anything that would leave it. */
export async function notePath(root: string, rel: string) {
  if (!rel || rel.includes("\0") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel))
    throw new PluginError("INVALID_ARGS", "Use a path inside the vault, such as Projects/Plan.md.");
  const withExt = /\.(md|canvas)$/i.test(rel) ? rel : `${rel}.md`;
  const abs = resolve(root, withExt);
  if (abs !== root && !abs.startsWith(root + sep))
    throw new PluginError("INVALID_ARGS", "That path leaves the vault.");
  // A symlink inside the vault must not point outside it.
  const parent = await realpath(dirname(abs)).catch(() => undefined);
  if (parent && parent !== root && !parent.startsWith(root + sep))
    throw new PluginError("INVALID_ARGS", "That path leaves the vault.");
  return abs;
}

async function* notes(root: string, dir = root): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // .obsidian, .trash
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* notes(root, p);
    else if (e.isFile() && e.name.endsWith(".md")) yield p;
  }
}

const today = (d = new Date()) => d.toISOString().slice(0, 10);

export const obsidianPlugin: PluginDef = registerPlugin({
  id: "obsidian",
  name: "Obsidian",
  description:
    "Search, read and write the notes of your Obsidian vault (when Zetta runs on your computer).",
  icon: "notebook",
  category: "docs",
  auth: "api-key",
  fields: [
    {
      key: "vault",
      label: "Vault folder",
      kind: "text",
      placeholder: "~/Documents/My Vault",
      help: "The folder Obsidian opens as your vault.",
    },
    {
      key: "dailyFolder",
      label: "Daily notes folder",
      kind: "text",
      optional: true,
      help: "Where daily notes live, if not the vault root.",
    },
  ],
  guide: () => [
    "In Obsidian, right-click the vault name and choose Reveal in Finder.",
    "Copy that folder's path and paste it here.",
  ],
  kind: "native",
  async install(c) {
    await vault(c);
  },
  async status(c) {
    const root = await vault(c);
    return { state: "connected", info: { vault: root.split(sep).pop() } };
  },
  tools: [
    {
      name: "search",
      description:
        "Find notes whose title or text contains the words. Returns paths and a line around the match.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      handler: async (c, a) => {
        const root = await vault(c);
        const words = str(a, "query", 200).toLowerCase().split(/\s+/).filter(Boolean);
        const out: { path: string; line: string }[] = [];
        for await (const p of notes(root)) {
          const text = (await readFile(p, "utf8")).slice(0, MAX_NOTE);
          const rel = relative(root, p);
          const hay = `${rel}\n${text}`.toLowerCase();
          if (!words.every((w) => hay.includes(w))) continue;
          const line =
            text.split("\n").find((l) => words.some((w) => l.toLowerCase().includes(w))) ?? "";
          out.push({ path: rel, line: line.slice(0, 200) });
          if (out.length >= 30) break;
        }
        return out;
      },
    },
    {
      name: "read",
      description: "The text of one note.",
      effect: "read",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (c, a) => {
        const root = await vault(c);
        const p = await notePath(root, str(a, "path", 500));
        return (
          await readFile(p, "utf8").catch(() => {
            throw new PluginError("NOT_FOUND", "That note does not exist.");
          })
        ).slice(0, MAX_NOTE);
      },
    },
    {
      name: "list",
      description: "Note paths in the vault, or in one folder of it.",
      effect: "read",
      inputSchema: { type: "object", properties: { folder: { type: "string" } } },
      handler: async (c, a) => {
        const root = await vault(c);
        const folder = optStr(a, "folder", 500);
        const start = folder ? dirname(await notePath(root, `${folder}/x`)) : root;
        const out: string[] = [];
        for await (const p of notes(root, start)) {
          out.push(relative(root, p));
          if (out.length >= MAX_LIST) break;
        }
        return out;
      },
    },
    {
      name: "write",
      description: "Create a note, or replace one when overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          overwrite: { type: "boolean" },
        },
        required: ["path", "content"],
      },
      handler: async (c, a) => {
        const root = await vault(c);
        const p = await notePath(root, str(a, "path", 500));
        const exists = await stat(p).then(
          () => true,
          () => false,
        );
        if (exists && a.overwrite !== true)
          throw new PluginError(
            "EXISTS",
            "That note already exists.",
            "Use append, or pass overwrite true to replace it.",
          );
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, str(a, "content", MAX_NOTE));
        return { path: relative(root, p), created: !exists };
      },
    },
    {
      name: "append",
      description:
        "Add text at the end of a note (it is created when missing). Without a path, appends to today's daily note.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["content"],
      },
      handler: async (c, a) => {
        const root = await vault(c);
        const daily = (c.config.dailyFolder ?? "").trim();
        const rel = optStr(a, "path", 500) ?? (daily ? `${daily}/${today()}` : today());
        const p = await notePath(root, rel);
        await mkdir(dirname(p), { recursive: true });
        await appendFile(p, `\n${str(a, "content", 20_000)}\n`);
        return { path: relative(root, p) };
      },
    },
    {
      name: "backlinks",
      description: "Notes that link to a note ([[Name]]).",
      effect: "read",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (c, a) => {
        const root = await vault(c);
        const name = str(a, "path", 500).replace(/\.md$/i, "").split("/").pop()!;
        const needle = `[[${name}`.toLowerCase();
        const out: string[] = [];
        for await (const p of notes(root))
          if ((await readFile(p, "utf8")).toLowerCase().includes(needle))
            out.push(relative(root, p));
        return out.slice(0, 100);
      },
    },
  ],
});
