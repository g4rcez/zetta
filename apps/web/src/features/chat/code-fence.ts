/** The language a file name asks for (`main.rs` is `rs`), or `text` when it has no extension. Shiki knows the common aliases. */
export function languageOf(fileName: string): string {
  return /\.([A-Za-z0-9]{1,12})$/.exec(fileName)?.[1]?.toLowerCase() ?? "text";
}

/** `text` as a fenced markdown block that nothing inside it can close early (the fence is longer than any run of backticks in it). */
export function fence(text: string, language: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${language.replace(/[^A-Za-z0-9_+#.-]/g, "")}\n${text}\n${ticks}`;
}

const PATCH = /^--- .+\n\+\+\+ .+\n@@ -\d|^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
const UNTAGGED_FENCE = /^(`{3,})[ \t]*(?:text|patch|mbox)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm;

/** The language to highlight a fenced block in: an untagged block that holds a unified diff or a `git format-patch` mail is `diff`. */
export function codeLanguage(language: string, text: string): string {
  return /^(?:|text|patch|mbox)$/i.test(language) && PATCH.test(text) ? "diff" : language;
}

/** Tags the untagged fenced blocks of a reply that hold a patch as `diff`, so the highlighter colors them. */
export function tagPatches(markdown: string): string {
  return markdown.replace(UNTAGGED_FENCE, (block, ticks: string, body: string) =>
    PATCH.test(body) ? `${ticks}diff\n${body}\n${ticks}` : block,
  );
}
