import type { ImageMode } from "./mail-api";

/**
 * The frame a message's HTML is shown in. The server has already cleaned the HTML with an allow list; this is the second wall.
 *
 * `sandbox` tokens, and why each one:
 *  - NO `allow-scripts`: no script of a message can run, whatever the HTML holds (inline handlers, `javascript:` links, `<script>`).
 *  - `allow-same-origin`: the page reads the frame's own height (`contentDocument`) to size it to its content, so a conversation reads as
 *    one column with no scrollbar per message and no script inside the frame. This is acceptable ONLY because `allow-scripts` is absent:
 *    a document that cannot run code cannot use the access, and the CSP below also forbids scripts. Never add `allow-scripts` here.
 *  - `allow-popups` + `allow-popups-to-escape-sandbox`: a link opens in a new tab; without the second token the opened site would inherit
 *    the sandbox and break (no scripts, no forms). The new page gets no handle on Zetta because every link also carries
 *    `rel="noopener noreferrer"` (the server writes it; `buildFrameDocument` also refuses `<base>`), and with no `allow-top-navigation`
 *    a link can never replace the app's own page.
 *  - Not allowed: forms, top navigation, pointer lock, modals, downloads, presentation.
 */
export const FRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/** What the frame may load: inline styles and `data:` images; with `remote`, also `https:` images. Nothing else, ever. */
export function frameCsp(images: ImageMode): string {
  return [
    "default-src 'none'",
    `img-src data:${images === "remote" ? " https:" : ""}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export type FramePalette = {
  scheme: "light" | "dark";
  foreground: string;
  background: string;
  link: string;
};

/** The page a mail that sets its own colours expects: dark text on white, whatever the app's theme is. */
export const PAPER: FramePalette = {
  scheme: "light",
  foreground: "#1a1a1a",
  background: "#ffffff",
  link: "#0b57d0",
};

/** A colour the frame's stylesheet may carry: hex, a colour function or a name. Anything else (a `;`, a brace, a quote) is refused. */
const COLOR =
  /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z\s.,%/+-]{1,80}\)|[a-z]{3,30})$/i;
const safeColor = (v: string, fallback: string) => (COLOR.test(v.trim()) ? v.trim() : fallback);

/** Whether the message paints itself: a colour or background in a style, or the old `bgcolor` / `color` attributes. */
export function setsOwnColors(html: string): boolean {
  return /(?:^|[\s;"'])(?:bgcolor|background-color|background|color)\s*[=:]/i.test(html);
}

/** The palette for one message: the app's own colours, or the white page when the message brings its own. */
export function paletteFor(html: string, app: FramePalette): FramePalette {
  return setsOwnColors(html) ? PAPER : app;
}

/**
 * Message HTML is put inside `<body>`, after the policy, so it can neither come before the CSP nor close the head. As a last wall, the
 * tags that could change the document itself (`meta`, `base`, `link`, `script`, `style`, `iframe`, `object`, `embed`, `form`) are turned
 * into visible text. The server's allow list never lets them through; this makes the frame safe on its own.
 */
export function defang(html: string): string {
  return html.replace(
    /<(\/?)\s*(meta|base|link|script|style|iframe|object|embed|form|frame|frameset|svg|math)\b/gi,
    "&lt;$1$2",
  );
}

const css = (p: FramePalette) =>
  [
    `html{color-scheme:${p.scheme};background:${p.background};color:${p.foreground}}`,
    "body{margin:0;padding:12px 16px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere}",
    `a{color:${p.link}}`,
    "img{max-width:100%;height:auto}",
    "table{max-width:100%}",
    "pre{white-space:pre-wrap}",
    "blockquote{margin:8px 0;padding-left:12px;border-left:2px solid currentColor;opacity:.85}",
  ].join("\n");

/** The whole `srcdoc`. The policy is the first thing in the head, and the message is the last thing in the body. */
export function buildFrameDocument(o: {
  html: string;
  images: ImageMode;
  palette: FramePalette;
}): string {
  const p: FramePalette = {
    scheme: o.palette.scheme === "dark" ? "dark" : "light",
    foreground: safeColor(o.palette.foreground, PAPER.foreground),
    background: safeColor(o.palette.background, PAPER.background),
    link: safeColor(o.palette.link, PAPER.link),
  };
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${frameCsp(o.images)}">`,
    '<meta name="referrer" content="no-referrer">',
    `<meta name="color-scheme" content="${p.scheme}">`,
    `<style>${css(p)}</style>`,
    "</head><body>",
    defang(o.html),
    "</body></html>",
  ].join("\n");
}

/** The app's colours as they are right now, read from the page's tokens. Falls back to the paper when a token is missing. */
export function readAppPalette(root: HTMLElement = document.documentElement): FramePalette {
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const dark = root.classList.contains("dark") || style.colorScheme.includes("dark");
  return {
    scheme: dark ? "dark" : "light",
    foreground: safeColor(token("--foreground"), dark ? "#ededf0" : PAPER.foreground),
    background: safeColor(token("--background"), dark ? "#0f0f11" : PAPER.background),
    link: safeColor(token("--primary"), dark ? "#47c7a1" : PAPER.link),
  };
}

/** A piece of a plain-text message: words, or an `http(s)` link. */
export type TextPart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const URL_AT = /https?:\/\/[^\s<>"'`]+/gi;
/** Trailing marks that belong to the sentence, not to the address. A closing bracket stays when the address opened one. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1) ?? "";
    const open = { ")": "(", "]": "[", "}": "{" }[last];
    const unmatched =
      open &&
      (url.match(new RegExp(`\\${open}`, "g")) ?? []).length <
        (url.match(new RegExp(`\\${last}`, "g")) ?? []).length;
    if (/[.,;:!?'"]/.test(last) || unmatched) url = url.slice(0, -1);
    else return url;
  }
}

/** Splits plain text into words and clickable links. Only `http` and `https` become links; `javascript:` and friends stay text. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_AT)) {
    const url = trimUrl(m[0]);
    let href: string | undefined;
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
    } catch {
      href = undefined;
    }
    if (!href) continue;
    if (m.index > at) parts.push({ kind: "text", text: text.slice(at, m.index) });
    parts.push({ kind: "link", text: url, href });
    at = m.index + url.length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}
