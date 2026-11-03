/** Mentions that address people, not bots. No bot may use one of these names. */
export const RESERVED_MENTIONS = ["user", "channel", "here", "all"] as const;

/** The legacy `@Name` / `#Name` word of a name: spaces removed, case-insensitive. */
export const mentionKey = (name: string) => name.replace(/\s+/g, "").toLowerCase();

export const isReservedBotName = (name: string) =>
  (RESERVED_MENTIONS as readonly string[]).includes(mentionKey(name));

const MENTION = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]{1,40})/gu;

/** True when the text addresses the person with a whole `@user` token (not `@username`, not an email). */
export const mentionsUser = (text: string) =>
  [...text.matchAll(MENTION)].some((m) => m[1]!.toLowerCase() === "user");

/**
 * A mention of a bot, team or room is a Markdown link whose target holds the id: `[@Dev](bot:<uuid>)`, `[#Core](team:<uuid>)`, `[#Launch](room:<uuid>)`.
 * The id is the truth; the label is a hint for readers that cannot look the id up, and screens show the current name instead.
 */
export type MentionKind = "bot" | "team" | "room";
export type Mention = {
  kind: MentionKind;
  id: string;
  label: string;
  index: number;
  length: number;
};

const SIGIL: Record<MentionKind, "@" | "#"> = { bot: "@", team: "#", room: "#" };
const LABEL_MAX = 80;
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LABEL = String.raw`(?:\\.|[^\]\\\n])`;
const TOKEN = new RegExp(
  String.raw`\[([@#])(${LABEL}{0,${LABEL_MAX}})\]\((bot|team|room):(${ID})\)`,
  "gi",
);

/** The source of the token pattern, for editor decorations that need their own regex instance. */
export const MENTION_TOKEN_SOURCE = TOKEN.source;

const escapeLabel = (s: string) => s.replace(/[\\[\]]/g, "\\$&");
/** The name a label holds, without the backslashes that protect `\`, `[` and `]`. */
export const unescapeMentionLabel = (s: string) => s.replace(/\\(.)/g, "$1");

export function mentionToken(kind: MentionKind, id: string, name: string): string {
  const label = name.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return `[${SIGIL[kind]}${escapeLabel(label)}](${kind}:${id})`;
}

/** Every well-formed mention token of `text`, in order. A sigil that does not fit the kind (`[#Dev](bot:…)`) is not a mention. */
export function parseMentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const kind = m[3]!.toLowerCase() as MentionKind;
    if (SIGIL[kind] !== m[1]) continue;
    out.push({
      kind,
      id: m[4]!.toLowerCase(),
      label: unescapeMentionLabel(m[2]!),
      index: m.index!,
      length: m[0].length,
    });
  }
  return out;
}

/** The ids of one kind that `text` mentions, once each, in order of first use. */
export const mentionIds = (text: string, kind: MentionKind): string[] => [
  ...new Set(
    parseMentions(text)
      .filter((m) => m.kind === kind)
      .map((m) => m.id),
  ),
];

/** `text` for a screen that shows plain text: every token becomes its sigil and label (`[@Dev](bot:…)` becomes `@Dev`). */
export function mentionsAsText(text: string): string {
  let out = "";
  let at = 0;
  for (const m of parseMentions(text)) {
    out += text.slice(at, m.index) + (m.kind === "bot" ? "@" : "#") + m.label;
    at = m.index + m.length;
  }
  return out + text.slice(at);
}

/** `text` with the label of every known id set to its current name. An unknown id keeps its label. */
export function refreshMentions(text: string, names: ReadonlyMap<string, string>): string {
  const all = parseMentions(text);
  let out = "";
  let at = 0;
  for (const m of all) {
    const name = names.get(m.id);
    out +=
      text.slice(at, m.index) +
      (name === undefined
        ? text.slice(m.index, m.index + m.length)
        : mentionToken(m.kind, m.id, name));
    at = m.index + m.length;
  }
  return out + text.slice(at);
}

export type MentionTarget = { kind: MentionKind; id: string; name: string };
export type LegacyMention = { sigil: "@" | "#"; key: string; index: number; length: number };

/** Text that a mention must not touch: code, links (tokens included) and bare URLs. */
const T = "`";
const PROTECTED = String.raw`${T}${T}${T}[\s\S]*?(?:${T}${T}${T}|$)|${T}[^${T}\n]*${T}|\[(?:\\.|[^\]\\\n])*\]\([^)\n]*\)|https?://\S+`;
const LEGACY = new RegExp(
  String.raw`${PROTECTED}|(?<![\p{L}\p{N}_])([@#])([\p{L}\p{N}_-]{1,40})`,
  "gu",
);

/** The legacy `@word` and `#word` of `text` (lower case), outside code, links and URLs, in order. A token is not one. */
export function legacyMentions(text: string): LegacyMention[] {
  const out: LegacyMention[] = [];
  for (const m of text.matchAll(LEGACY))
    if (m[1] && m[2])
      out.push({
        sigil: m[1] as "@" | "#",
        key: m[2].toLowerCase(),
        index: m.index!,
        length: m[0].length,
      });
  return out;
}

/**
 * Turns the legacy `@Name` and `#Name` words of `text` into tokens. `resolve` finds the target of a word (the caller owns the rules for
 * visibility and for two targets with one name); a word it does not know stays as written. Code, links and URLs are left alone, so running it again changes nothing.
 */
export function normalizeMentions(
  text: string,
  resolve: (sigil: "@" | "#", key: string) => MentionTarget | undefined,
): string {
  return text.replace(LEGACY, (whole, sigil?: "@" | "#", word?: string) => {
    if (!sigil || !word) return whole;
    const t = resolve(sigil, word.toLowerCase());
    return t && SIGIL[t.kind] === sigil ? mentionToken(t.kind, t.id, t.name) : whole;
  });
}
