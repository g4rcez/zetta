import type { Relation } from "./memory-api";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const LINK = /\[\[(?:(related|depends-on|part-of|supersedes):)?([a-z0-9-]{1,80})\]\]/g;
/** Elements whose text stays as written. */
const SKIP = new Set(["pre", "code", "a", "memory-link", "gh-ref", "bot-tag"]);

export type MemoryLinkPart =
  | { text: string; slug?: undefined; relation?: undefined }
  | { text: string; slug: string; relation: Relation };

/** Splits `text` where it holds `[[slug]]` or `[[relation:slug]]`. Returns `undefined` when it holds none. */
export function splitMemoryLinks(text: string): MemoryLinkPart[] | undefined {
  const parts: MemoryLinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], slug: m[2]!, relation: (m[1] ?? "related") as Relation });
    last = m.index + m[0].length;
  }
  if (!parts.length) return undefined;
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A rehype plugin that turns the memory links of a text into `<memory-link>` elements (drawn as router links by the Response). */
export const rehypeMemoryLinks = () => (tree: Node) => {
  const walk = (node: Node) => {
    if (!node.children || (node.tagName && SKIP.has(node.tagName))) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text") {
        const parts = splitMemoryLinks(child.value ?? "");
        return parts
          ? parts.map<Node>((p) =>
              p.slug
                ? {
                    type: "element",
                    tagName: "memory-link",
                    properties: { dataSlug: p.slug, dataRelation: p.relation },
                    children: [{ type: "text", value: p.text }],
                  }
                : { type: "text", value: p.text },
            )
          : [child];
      }
      walk(child);
      return [child];
    });
  };
  walk(tree);
};
