import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { PlaygroundFileSnapshot, PlaygroundLanguage } from "@zetta/db/schema/playground";
import { writeFolder } from "./run-folder";
import { PlaygroundError } from "./types";

const MAX_PAGE_BYTES = 5_000_000;
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// A macro runs its code on the server while it bundles. Refuse it: a browser playground runs in the page, never on the server.
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

/** Bundles one file of the playground for the browser. Imports stay inside the playground folder; a URL import stays a URL. */
async function bundle(dir: string, abs: string, format: "esm" | "iife") {
  const result = await Bun.build({
    entrypoints: [abs],
    target: "browser",
    format,
    plugins: [
      {
        name: "confine",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            // The page may load a library from a public CDN; the page's CSP lists which ones.
            if (/^https?:\/\//.test(args.path)) return { path: args.path, external: true };
            if (args.path.startsWith(".") || isAbsolute(args.path)) {
              const target = args.importer
                ? resolve(dirname(args.importer), args.path)
                : resolve(args.path);
              if (target !== dir && !target.startsWith(dir + sep))
                throw new Error(`The import ${args.path} leaves the playground.`);
              return undefined;
            }
            throw new Error(
              `The import ${args.path} is not a file of the playground. Import a library from a URL, for example https://cdn.jsdelivr.net/npm/...`,
            );
          });
        },
      },
    ],
  }).catch((e: unknown) => {
    // A failed build throws; a plugin's own error arrives as the text of the first message. The temp folder is not shown.
    const first =
      (e as { errors?: { message?: string }[] } | undefined)?.errors?.[0]?.message ??
      (e as Error | undefined)?.message;
    throw new PlaygroundError(
      "INVALID",
      first ? first.replaceAll(dir + sep, "").slice(0, 300) : "The files could not be built.",
    );
  });
  if (!result.success)
    throw new PlaygroundError(
      "INVALID",
      result.logs.find((l) => l.level === "error")?.message ?? "The files could not be built.",
    );
  const main = result.outputs.find((o) => o.kind === "entry-point") ?? result.outputs[0];
  if (!main) throw new PlaygroundError("INVALID", "The build made no output.");
  // `</script` in the code would end the tag it is inlined in.
  return (await main.text()).replaceAll("</script", "<\\/script");
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
}): Promise<{ html: string }> {
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
        const code = await bundle(
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
      const code = await bundle(dir, abs(input.entry), "esm");
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
