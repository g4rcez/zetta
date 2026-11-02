import { splitWikiLinks } from "./wiki-markdown";

export const ASK_SCOPE_MAX = 5; // the server takes at most five picked items per message

/** What the chief is asked. The answer's `[[slug]]` links become the cited sources. */
export const askPrompt = (question: string) =>
  `Answer from my wiki and cite the items you use as [[slug]]. Question: ${question.trim()}`;

export type Source = { slug: string; title: string };

/**
 * Splits the items the bot was shown into those the answer names (cited) and the rest (considered). The server records what the bot
 * was shown, not what it used, so only a `[[slug]]` in the answer counts as a citation.
 */
export function sourcesOf(answer: string, shown: readonly Source[]) {
  const named = new Set((splitWikiLinks(answer) ?? []).flatMap((p) => (p.slug ? [p.slug] : [])));
  return {
    cited: shown.filter((s) => named.has(s.slug)),
    considered: shown.filter((s) => !named.has(s.slug)),
  };
}
