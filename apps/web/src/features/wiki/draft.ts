/** A change to the wiki that exists only in a link: nothing is saved, the URL holds the whole state. */
export type WikiDraft =
  | { action: "write"; slug: string; title: string; content: string; howto: string; tags: string[] }
  | { action: "patch"; slug: string; match: string; content: string }
  | { action: "link"; slug: string; to: string; relation: string }
  | { action: "confirm" | "sources" | "archive" | "mark_stale"; slug: string };

/** Longer than this and the link may break in browsers, proxies or chat apps: no link, no preview. */
const MAX_LENGTH = 32_000;

const toBase64Url = (text: string) =>
  btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const fromBase64Url = (s: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)),
  );

/** The `d` search value for a draft, or undefined when the draft is too big for a link. */
export function encodeDraft(draft: WikiDraft): string | undefined {
  const s = toBase64Url(JSON.stringify(draft));
  return s.length > MAX_LENGTH ? undefined : s;
}

/** Keeps only what a draft needs; anything that is not a draft gives undefined. */
function toDraft(v: unknown): WikiDraft | undefined {
  if (!v || typeof v !== "object") return undefined;
  const a = v as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  const slug = str("slug");
  if (slug === undefined) return undefined;
  switch (a.action) {
    case "write": {
      const title = str("title");
      const content = str("content");
      if (title === undefined || content === undefined) return undefined;
      const tags = Array.isArray(a.tags)
        ? a.tags.filter((t): t is string => typeof t === "string")
        : [];
      return { action: "write", slug, title, content, howto: str("howto") ?? "", tags };
    }
    case "patch": {
      const match = str("match");
      const content = str("content");
      return match === undefined || content === undefined
        ? undefined
        : { action: "patch", slug, match, content };
    }
    case "link": {
      const to = str("to");
      return to === undefined
        ? undefined
        : { action: "link", slug, to, relation: str("relation") ?? "related" };
    }
    case "confirm":
    case "sources":
    case "archive":
    case "mark_stale":
      return { action: a.action, slug };
    default:
      return undefined;
  }
}

/** Reads the `d` search value. The URL is untrusted. */
export function decodeDraft(value: unknown): WikiDraft | undefined {
  if (typeof value !== "string" || !value || value.length > MAX_LENGTH) return undefined;
  try {
    return toDraft(JSON.parse(fromBase64Url(value)));
  } catch {
    return undefined;
  }
}

/** The link value for a wiki proposal. Reading actions never become proposals, so they have nothing to preview. */
export function draftFromProposal(patch: Record<string, unknown> | undefined): string | undefined {
  const draft = toDraft(patch?.args);
  return draft && encodeDraft(draft);
}
