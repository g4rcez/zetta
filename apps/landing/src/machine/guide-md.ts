import { REPO, SITE } from "../links";

const GUIDE_DIR = "docs/wiki/user-guide";

/** Where a relative link of a guide page points inside the repository ("../../../tasks/x.md" -> "tasks/x.md"). */
export function resolved(target: string): string {
  const parts = GUIDE_DIR.split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * A guide page for the site: its navigation line is dropped, a link to another guide page points at that page's Markdown on the site,
 * and every other relative link points at the file on GitHub, so nothing leads to a path that does not exist here.
 */
export function guideMarkdown(raw: string, slugs: ReadonlySet<string>): string {
  const body = raw
    .split("\n")
    .filter((line) => !line.startsWith("[Wiki home]("))
    .join("\n")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return whole;
      const [path = "", hash = ""] = href.split("#");
      const slug = path.replace(/\.md$/, "");
      if (slugs.has(slug) && !path.includes("/"))
        return `[${text}](${SITE}/docs/${slug}.md${hash ? `#${hash}` : ""})`;
      return `[${text}](${REPO}/blob/main/${resolved(path)}${hash ? `#${hash}` : ""})`;
    });
  return `${body.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** The first sentence of `text`. A full stop inside a quotation ("... sources. Link ...") does not end it. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  let quoted = false;
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i]!;
    if (ch === "“") quoted = true;
    else if (ch === "”") quoted = false;
    else if (ch === '"') quoted = !quoted;
    if (!/[.!?]/.test(ch)) continue;
    // Inside a quotation only a mark that closes it ends the sentence: "Say “Do this. Then that.” Next" ends after that.”
    if (quoted && flat[i + 1] !== "”" && flat[i + 1] !== '"') continue;
    // The mark may be followed by a closing quote or bracket, then a space: that is the end.
    let end = i + 1;
    while (end < flat.length && /["”')\]]/.test(flat[end]!)) end++;
    if (end === flat.length || flat[end] === " ") return flat.slice(0, end);
  }
  return flat;
}

/**
 * What a guide page is about, for the index: the first sentence of its first plain paragraph. The status note, headings, tables, lists,
 * code, and a paragraph that is only an example are not it.
 */
export function summaryOf(markdown: string): string {
  for (const block of markdown.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text || /^(#|>|\||\[|-|\*|\d+\.|```)/.test(text) || /^For example\b/i.test(text)) continue;
    return firstSentence(text);
  }
  return "";
}
