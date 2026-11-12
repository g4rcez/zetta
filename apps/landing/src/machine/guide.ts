import { guideMarkdown, summaryOf } from "./guide-md";

// The user guide lives in docs/wiki/user-guide (the repository's own documentation); the site only republishes it as Markdown.
const files = import.meta.glob("../../../../docs/wiki/user-guide/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type GuidePage = { slug: string; title: string; summary: string; markdown: string };

/** Every page of the user guide, in a stable order. */
export function guidePages(): GuidePage[] {
  const raws = Object.entries(files).map(([path, raw]) => ({
    slug: path.split("/").at(-1)!.replace(/\.md$/, ""),
    raw,
  }));
  const slugs = new Set(raws.map((r) => r.slug));
  return raws
    .map(({ slug, raw }) => {
      const markdown = guideMarkdown(raw, slugs);
      return {
        slug,
        title: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? slug,
        summary: summaryOf(markdown),
        markdown,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
