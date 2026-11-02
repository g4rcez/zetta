import type { BotTagBot } from "@/components/bot-tag";

import { mentionKey } from "./mention";

/** What the tags need of a bot. */
export type TagBot = BotTagBot & { name: string };

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Elements whose text stays as written: code, links, and the tags this plugin already made. */
const SKIP = new Set(["code", "pre", "a", "bot-tag", "gh-ref"]);

export type TagPart = { text: string } | { text: string; bot: TagBot };

/**
 * Splits `text` where it names a bot: `Name` (exact case) or `@Name` / `@NameWithoutSpaces` (any case, as the server matches mentions).
 * Returns `undefined` when no bot is named.
 */
export function splitBotTags(text: string, bots: readonly TagBot[]): TagPart[] | undefined {
  const byWord = new Map<string, TagBot>();
  for (const b of bots)
    for (const w of new Set([b.name, mentionKey(b.name)]))
      if (w && !byWord.has(w.toLowerCase())) byWord.set(w.toLowerCase(), b);
  if (!byWord.size) return undefined;
  const words = [...byWord.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_@])(@?)(${words.join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const parts: TagPart[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const bot = byWord.get(m[2]!.toLowerCase())!;
    // Without `@` a bot named "Boss" must not tag the word "boss".
    if (!m[1] && ![bot.name, mentionKey(bot.name)].includes(m[2]!)) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], bot });
    last = m.index + m[0].length;
  }
  if (!parts.length) return undefined;
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A rehype plugin that turns the bot names of a reply into `<bot-tag>` elements (drawn by `BotTag` in the Response). */
export const rehypeBotTags = (bots: readonly TagBot[]) => () => (tree: Node) => {
  const walk = (node: Node) => {
    if (!node.children || (node.tagName && SKIP.has(node.tagName))) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text") {
        walk(child);
        return [child];
      }
      const parts = splitBotTags(child.value ?? "", bots);
      if (!parts) return [child];
      return parts.map<Node>((p) =>
        "bot" in p
          ? {
              type: "element",
              tagName: "bot-tag",
              properties: { dataBotId: p.bot.id },
              children: [{ type: "text", value: p.text }],
            }
          : { type: "text", value: p.text },
      );
    });
  };
  walk(tree);
};
