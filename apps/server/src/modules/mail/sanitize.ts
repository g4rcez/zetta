/**
 * Turns the HTML a sender wrote (`MailMessage.htmlUnsafe`) into HTML that is safe to put in a sandboxed frame. It is an allow list: a tag, an
 * attribute, a link scheme or a style property that is not named here is dropped. Scripts, forms, frames, `<base>`, `<meta>`, `<link>`,
 * `<svg>` and `<math>` never survive; a link keeps only http, https and mailto; a style can never load anything.
 *
 * Images: `cid:` images become `data:` URLs built from the same message's own inline parts (real image bytes only, never SVG, with a cap per
 * image and per message). A remote image is removed unless the caller asks to keep it, and then only over https. The result says which.
 *
 * Nothing here reads a mailbox: the inline parts are handed in by the caller.
 */
import sanitizeHtml, { type IOptions } from "sanitize-html";

export const SANITIZE_LIMITS = {
  /** One inline image, decoded. */
  inlineImageBytes: 500_000,
  /** All inline images of one message, decoded. */
  inlineTotalBytes: 1_500_000,
  /** The cleaned HTML; a longer message is shown as text only. */
  htmlChars: 600_000,
  /** How many `cid:` images are looked at in one message. */
  inlineImages: 20,
} as const;

/** `blocked`: remote images are removed. `remote`: https images are kept. */
export type ImageMode = "blocked" | "remote";
/** `none`: the message had no remote image to hide or show. `removed`: at least one was removed. `shown`: they were kept. */
export type RemoteImages = "none" | "removed" | "shown";
/** `ok`, or `too_large`: the cleaned HTML passed the limit and is left out (the text is still there). */
export type HtmlSize = "ok" | "too_large";

export type InlinePart = { contentType: string; bytes: Uint8Array };

export type SanitizedHtml = {
  html: string;
  remoteImages: RemoteImages;
  /** How many `cid:` images were turned into data URLs. */
  inlineImages: number;
  size: HtmlSize;
};

const ALLOWED_TAGS = [
  "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "div",
  "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "mark", "ol", "p", "pre", "q", "s",
  "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul",
]; // prettier-ignore

/** Dropped together with everything inside them (the default only drops script, style, textarea and option). */
const NON_TEXT_TAGS = [
  "script", "style", "textarea", "option", "svg", "math", "iframe", "object", "embed", "noscript", "template", "head", "title", "select",
  "frameset", "frame", "applet", "xmp", "plaintext", "noembed", "noframes",
]; // prettier-ignore

/** A style value may name colours, sizes and words; never a function that loads (`url`, `image-set`), `expression`, an escape or an at-rule. */
const SAFE_VALUE =
  /^(?!.*(?:url|image|expression|behavior|binding|javascript|@|\\|\/\*|<|>)).{1,120}$/i;
const PLAIN = [SAFE_VALUE];
const STYLE_PROPERTIES = [
  "color", "background-color", "text-align", "font-size", "font-weight", "font-style", "font-family", "text-decoration", "line-height",
  "width", "height", "max-width", "min-width", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "border", "border-top", "border-right", "border-bottom",
  "border-left", "border-color", "border-width", "border-style", "border-collapse", "border-radius", "vertical-align", "white-space",
  "text-transform", "letter-spacing", "list-style-type",
]; // prettier-ignore
const ALLOWED_STYLES = { "*": Object.fromEntries(STYLE_PROPERTIES.map((p) => [p, PLAIN])) };

const ABSOLUTE_LINK = /^(?:https?:|mailto:)/i;
/** What a scheme check must not be fooled by: control characters and spaces inside the value. */
const squash = (v: string) =>
  Array.from(v)
    .filter((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127)
    .join("");

/** The `cid:` ids a message's HTML points to (lower case, without `cid:`), in order, so the caller reads only those parts. */
export function referencedCids(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /\bsrc\s*=\s*(?:"\s*cid:([^"]*)"|'\s*cid:([^']*)'|cid:([^\s>]+))/gi,
  )) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      /* keep the raw text */
    }
    id = id.replace(/^<|>$/g, "").toLowerCase();
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, SANITIZE_LIMITS.inlineImages);
}

/** The image type a file's first bytes show, or undefined. Only these four are ever inlined: the declared type is not trusted, SVG is never one. */
export function imageTypeOf(b: Uint8Array): string | undefined {
  const at = (i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length > 8 && b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a)
    return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (b.length > 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  return undefined;
}

export function sanitizeMailHtml(
  htmlUnsafe: string,
  o: { images?: ImageMode; inline?: ReadonlyMap<string, InlinePart> } = {},
): SanitizedHtml {
  if (!htmlUnsafe.trim()) return { html: "", remoteImages: "none", inlineImages: 0, size: "ok" };
  const mode = o.images ?? "blocked";
  let removed = false;
  let shown = false;
  let inlineImages = 0;
  let inlineBytes = 0;
  const dataUrls = new Map<string, string>();

  const inlineSrc = (cid: string): string | undefined => {
    const hit = dataUrls.get(cid);
    if (hit) return hit;
    const part = o.inline?.get(cid);
    if (!part || part.bytes.length > SANITIZE_LIMITS.inlineImageBytes) return undefined;
    const type = imageTypeOf(part.bytes);
    if (!type || inlineBytes + part.bytes.length > SANITIZE_LIMITS.inlineTotalBytes)
      return undefined;
    inlineBytes += part.bytes.length;
    const url = `data:${type};base64,${Buffer.from(part.bytes).toString("base64")}`;
    dataUrls.set(cid, url);
    return url;
  };

  const options: IOptions = {
    allowedTags: ALLOWED_TAGS,
    nonTextTags: NON_TEXT_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "style"],
      font: ["color", "face", "size"],
      td: ["colspan", "rowspan", "align", "valign", "width", "height", "bgcolor", "style"],
      th: ["colspan", "rowspan", "align", "valign", "width", "height", "bgcolor", "style"],
      table: ["align", "width", "border", "cellpadding", "cellspacing", "bgcolor", "style"],
      "*": ["style", "align", "dir", "lang", "title"],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https", "data"] },
    allowProtocolRelative: false,
    // The tag is already cleaned of the attributes that are not listed; these rewrite the two that carry an address.
    transformTags: {
      a: (tagName, attribs) => {
        const href = squash(attribs.href ?? "");
        return {
          tagName,
          attribs: {
            ...(ABSOLUTE_LINK.test(href) ? { href: attribs.href!.trim() } : {}),
            ...(attribs.title ? { title: attribs.title } : {}),
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        };
      },
      img: (tagName, attribs) => {
        const { src: raw = "", ...rest } = attribs;
        const src = squash(raw);
        if (/^cid:/i.test(src)) {
          let id = src.slice(4);
          try {
            id = decodeURIComponent(id);
          } catch {
            /* keep the raw text */
          }
          const url = inlineSrc(id.replace(/^<|>$/g, "").toLowerCase());
          if (url) inlineImages++;
          return { tagName, attribs: url ? { ...rest, src: url } : rest };
        }
        if (/^(?:https?:)?\/\//i.test(src)) {
          if (mode === "remote" && /^https:\/\//i.test(src)) {
            shown = true;
            return {
              tagName,
              attribs: { ...rest, src: raw.trim(), referrerpolicy: "no-referrer" },
            };
          }
          if (mode === "blocked") removed = true;
        }
        // A `data:` image from the sender, a relative path or anything else: not shown.
        return { tagName, attribs: rest };
      },
    },
    // An image that lost its source says nothing.
    exclusiveFilter: (f) => f.tag === "img" && !f.attribs.src,
  };
  // `referrerpolicy` is added by the transform above, so it must be allowed on images.
  (options.allowedAttributes as Record<string, string[]>).img!.push("referrerpolicy");

  const html = sanitizeHtml(htmlUnsafe, options).trim();
  const remoteImages: RemoteImages =
    mode === "remote" ? (shown ? "shown" : "none") : removed ? "removed" : "none";
  if (html.length > SANITIZE_LIMITS.htmlChars)
    return { html: "", remoteImages, inlineImages, size: "too_large" };
  return { html, remoteImages, inlineImages, size: "ok" };
}

/**
 * The words of an HTML message as plain text, for a reader that is not a page (a bot). Every tag goes, together with what is not text
 * (scripts, styles, the head); a break tag or the end of a block becomes a line break; links, images and their addresses are dropped. The
 * result is text: it is never to be put in a page as HTML.
 */
export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const broken = html.replace(
    /<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|blockquote|table|pre)\s*>/gi,
    "$&\n",
  );
  const bare = sanitizeHtml(broken, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: NON_TEXT_TAGS,
  });
  return bare
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
