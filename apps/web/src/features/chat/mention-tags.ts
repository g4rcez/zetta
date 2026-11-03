import type { MentionKind } from "@zetta/core/mentions";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const HREF = /^(bot|team|room):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SIGIL: Record<MentionKind, string> = { bot: "@", team: "#", room: "#" };

/**
 * A rehype plugin that turns the mention links of a text (`[@Dev](bot:<id>)`, see `@zetta/core/mentions`) into `<mention-tag>` elements
 * (drawn by `MentionTag`). A link whose text does not start with the sigil of its kind stays an ordinary link.
 * It runs after sanitize, which must let the `bot:`, `team:` and `room:` protocols through (see response.tsx).
 */
export const rehypeMentionLinks = () => (tree: Node) => {
  const walk = (node: Node) => {
    if (
      node.type === "element" &&
      node.tagName === "a" &&
      typeof node.properties?.href === "string"
    ) {
      const m = HREF.exec(node.properties.href);
      const kind = m?.[1]!.toLowerCase() as MentionKind | undefined;
      const first = node.children?.[0];
      if (m && kind && first?.type === "text" && first.value?.startsWith(SIGIL[kind])) {
        node.tagName = "mention-tag";
        node.properties = { dataKind: kind, dataId: m[2]!.toLowerCase() };
        return;
      }
    }
    node.children?.forEach(walk);
  };
  walk(tree);
};
