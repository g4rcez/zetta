export type TaskLink = { url: string; label: string; internal: boolean };

const MARKDOWN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const BARE = /https?:\/\/[^\s<>()[\]"']+/g;
const TRAILING = /[.,;:!?]+$/;

/** Turns a raw url into a safe link, or nothing. A url of this app's own origin becomes a path, so it routes without a reload. */
function toLink(raw: string, label: string | undefined, origin: string): TaskLink | undefined {
  const url = raw.replace(TRAILING, "");
  if (url.startsWith("/") && !url.startsWith("//"))
    return { url, label: label ?? url, internal: true };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (parsed.origin === origin) {
    const path = parsed.pathname + parsed.search + parsed.hash;
    return { url: path, label: label ?? path, internal: true };
  }
  const short = parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  return { url: parsed.href, label: label ?? short, internal: false };
}

/** Links found in the given texts (markdown links and bare urls), in order of first appearance, without repeats. */
export function extractLinks(texts: string[], origin: string): TaskLink[] {
  const seen = new Set<string>();
  const links: TaskLink[] = [];
  const add = (raw: string, label?: string) => {
    const link = toLink(raw, label?.trim(), origin);
    if (!link || seen.has(link.url)) return;
    seen.add(link.url);
    links.push(link);
  };
  for (const text of texts) {
    const rest = text.replace(MARKDOWN, (_, label: string, url: string) => {
      add(url, label);
      return " ";
    });
    for (const match of rest.matchAll(BARE)) add(match[0]);
  }
  return links;
}
