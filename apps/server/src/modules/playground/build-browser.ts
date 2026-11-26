import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { PlaygroundFileSnapshot, PlaygroundLanguage } from "@zetta/db/schema/playground";
import { PLAYGROUND_LIMITS } from "./languages";
import { writeFolder } from "./run-folder";
import { PlaygroundError } from "./types";

const MAX_PAGE_BYTES = 5_000_000;
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// Some bundlers run a "macro" import on the server while they bundle. This one has no macros, so such an import is only code of the
// page; the check stays to say so in plain words. Nothing here depends on it to keep code off the server.
const MACRO = /\btype\s*:\s*["']macro["']/;

/** Runs in the page first: the inputs, and a copy of every console line and error to the parent window (the Output panel). */
const prelude = (inputs: Record<string, unknown>) => {
  // `<` is escaped so a value can never close the script tag.
  const data = JSON.stringify(inputs).replaceAll("<", "\\u003c");
  return `<script>window.ZETTA_INPUTS = ${data};
(function () {
  var show = function (v) {
    if (v instanceof Error) return v.stack || v.message;
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  };
  var send = function (level, args) {
    try { parent.postMessage({ source: "zetta-playground", level: level, text: Array.prototype.map.call(args, show).join(" ") }, "*"); } catch (e) {}
  };
  ["log", "info", "warn", "error"].forEach(function (level) {
    var original = console[level];
    console[level] = function () { send(level, arguments); return original.apply(console, arguments); };
  });
  addEventListener("error", function (e) { send("error", [e.error || e.message]); });
  addEventListener("unhandledrejection", function (e) { send("error", [e.reason]); });
})();</script>`;
};

/** A path or id without the `?query` or `#hash` a bundler may carry on it. */
const bare = (path: string) => path.replace(/[?#].*$/s, "");

/** The first message of a failed build, with no colour codes. */
const messageOf = (e: unknown) =>
  Bun.stripANSI(
    (e as { errors?: { message?: string }[] } | undefined)?.errors?.[0]?.message ??
      (e as Error | undefined)?.message ??
      "",
  );

/**
 * Bundles one file of the playground for the browser. Imports stay inside the playground folder; a URL import stays a URL.
 * The bundler only reads and rewrites the source: nothing of the playground runs on the server. It must stay that way, so no
 * option here may come from the playground.
 */
async function bundle(dir: string, abs: string, format: "esm" | "iife") {
  const inside = (path: string) => path === dir || path.startsWith(dir + sep);
  let refused: string | undefined;
  const refuse = (message: string): never => {
    refused ??= message;
    throw new Error(message);
  };
  const leaves = (what: string) => `The import ${what} leaves the playground.`;
  try {
    // Loaded on the first build, so an install without the bundler's native part still starts and only browser builds fail.
    const { rolldown } = await import("rolldown");
    const build = await rolldown({
      input: abs,
      cwd: dir,
      platform: "browser",
      tsconfig: false,
      logLevel: "silent",
      // A stylesheet a script imports is left out; the page names its stylesheets with <link>.
      moduleTypes: { ".css": "empty", ".txt": "text", ".md": "text" },
      plugins: [
        {
          name: "confine",
          resolveId(source: string, importer: string | undefined) {
            // The page may load a library from a public CDN; the page's CSP lists which ones.
            if (/^https?:\/\//.test(source)) return { id: source, external: true };
            const path = bare(source);
            if (path.startsWith(".") || isAbsolute(path)) {
              const target = importer ? resolve(dirname(importer), path) : resolve(path);
              if (!inside(target)) refuse(leaves(source));
              return null;
            }
            return refuse(
              `The import ${source} is not a file of the playground. Import a library from a URL, for example https://cdn.jsdelivr.net/npm/...`,
            );
          },
          // The second guard: whatever a path resolved to (a folder's package.json may name any file), only files of the build are
          // read. An id that starts with NUL is the bundler's own runtime, which no import of a playground can name.
          load(id: string) {
            if (!id.startsWith("\0") && !inside(bare(id))) refuse(leaves("of a file"));
            return null;
          },
        },
      ],
    });
    try {
      const { output } = await build.generate({ format, codeSplitting: false });
      // `</script` in the code would end the tag it is inlined in.
      return output[0].code.replaceAll("</script", "<\\/script");
    } finally {
      await build.close();
    }
  } catch (e) {
    // A plugin's refusal arrives wrapped in the bundler's own text, so the plain one is kept. The temp folder is not shown.
    const first = refused ?? messageOf(e);
    throw new PlaygroundError(
      "INVALID",
      first ? first.replaceAll(dir + sep, "").slice(0, 300) : "The files could not be built.",
    );
  }
}

const tooLong = () => new PlaygroundError("INVALID", "The build took too long and was stopped.");

/** What `work` makes, or a refusal when it takes longer than `ms`. The bundler cannot be interrupted: its late result is dropped. */
async function within<T>(work: () => Promise<T>, ms: number) {
  if (ms <= 0) throw tooLong();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(tooLong()), ms);
  });
  const running = work();
  running.catch(() => {});
  try {
    return await Promise.race([running, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds a browser playground into one HTML page that needs no other file: the page in an iframe has no address to load them from.
 * - `html`: the entry is the page. A `<script src>` or `<link rel="stylesheet">` that names a file of the playground is bundled and inlined.
 * - `typescript` and `javascript`: the entry is bundled into a module script in an empty page with `<div id="app">`.
 */
export async function buildBrowser(input: {
  language: PlaygroundLanguage;
  entry: string;
  files: readonly PlaygroundFileSnapshot[];
  inputs: Record<string, unknown>;
  /** Markup that goes first in the page's head, before everything else (an app's page puts its policy and its bridge here). */
  head?: string;
  /** How long the whole build may take. */
  timeoutMs?: number;
}): Promise<{ html: string }> {
  const deadline = Date.now() + (input.timeoutMs ?? PLAYGROUND_LIMITS.buildMs);
  const bundled = (dir: string, abs: string, format: "esm" | "iife") =>
    within(() => bundle(dir, abs, format), deadline - Date.now());
  for (const f of input.files)
    if (SCRIPT.test(f.path) && MACRO.test(f.content))
      throw new PlaygroundError(
        "INVALID",
        `${f.path} uses a macro. Macros run on the server and are not allowed.`,
      );
  // The real path: the bundler reports importers by it, and a temp folder is a link on macOS.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "zetta-playground-build-")));
  try {
    await writeFolder(dir, { files: input.files, inputs: input.inputs });
    const abs = (path: string) => resolve(dir, path);
    const local = (from: string, ref: string) => {
      const path = join(dirname(from), ref).split(sep).join("/");
      return input.files.some((f) => f.path === path) ? path : undefined;
    };
    let page: string;
    if (input.language === "html") {
      page = await readFile(abs(input.entry), "utf8");
      const scripts = [
        ...page.matchAll(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi),
      ];
      for (const m of scripts) {
        if (/^(https?:)?\/\//.test(m[3]!)) continue;
        const path = local(input.entry, m[3]!);
        if (!path || !SCRIPT.test(path))
          throw new PlaygroundError(
            "INVALID",
            `The script ${m[3]} is not a file of the playground.`,
          );
        const attrs = `${m[1]}${m[4]}`.trim();
        const code = await bundled(
          dir,
          abs(path),
          /\btype\s*=\s*["']module["']/i.test(attrs) ? "esm" : "iife",
        );
        page = page.replace(m[0], () => `<script${attrs ? ` ${attrs}` : ""}>${code}</script>`);
      }
      const links = [...page.matchAll(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi)];
      for (const m of links) {
        const href = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(m[0])?.[2];
        if (!href || /^(https?:)?\/\//.test(href)) continue;
        const path = local(input.entry, href);
        if (!path)
          throw new PlaygroundError(
            "INVALID",
            `The stylesheet ${href} is not a file of the playground.`,
          );
        const css = (await readFile(abs(path), "utf8")).replaceAll("</style", "<\\/style");
        page = page.replace(m[0], () => `<style>${css}</style>`);
      }
    } else {
      const code = await bundled(dir, abs(input.entry), "esm");
      page = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module">${code}</script></body></html>`;
    }
    // First thing in the document, so it is in place before any script of the page runs.
    const head = /<head\b[^>]*>/i.exec(page) ?? /<html\b[^>]*>/i.exec(page);
    const first = (input.head ?? "") + prelude(input.inputs);
    // With no head or html tag the markup goes after the doctype: before it, the browser would read the page in quirks mode.
    const doctype = /^\s*<!doctype[^>]*>/i.exec(page);
    const at = head ? head.index + head[0].length : (doctype?.[0].length ?? 0);
    const html = page.slice(0, at) + first + page.slice(at);
    if (Buffer.byteLength(html) > MAX_PAGE_BYTES)
      throw new PlaygroundError("TOO_LARGE", "The built page is over 5 MB.");
    return { html };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
