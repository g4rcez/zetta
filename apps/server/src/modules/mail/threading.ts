/**
 * Groups messages into conversations. Pure: no I/O, no mailbox, no clock.
 *
 * Messages are joined by what they say about each other: a message is linked to every id in its `In-Reply-To` and `References`
 * headers (union-find over message ids), so a chain, two replies to the same message, and a reply to a reply all end up together.
 *
 * Fallback, and only this one: a reply (a "Re:"-style subject) that carries no reference header at all joins a conversation that has a
 * message with the same normalised subject within 30 days. Two messages are never joined on the subject alone otherwise: a new message
 * with the same subject as an old one starts its own conversation, and a reply whose headers point somewhere stays where they point.
 */

export type ThreadMessage = {
  /** Anything unique in the set (the mailbox uses folder and uid). */
  key: string;
  /** The Message-ID header, without angle brackets; empty when missing. */
  messageId: string;
  /** Ids from In-Reply-To, without angle brackets. */
  inReplyTo: readonly string[];
  /** Ids from References, without angle brackets. */
  references: readonly string[];
  subject: string;
  /** Milliseconds since the epoch; 0 or NaN when the message has no date. */
  time: number;
};

export const THREAD_FALLBACK_DAYS = 30;
const DAY = 86_400_000;

/** The ids of a `Message-ID`, `In-Reply-To` or `References` header value: every `<...>` in it, trimmed and lower case. */
export const parseMessageIds = (value: string | undefined | null): string[] => {
  const out: string[] = [];
  for (const m of (value ?? "").matchAll(/<([^<>\s]{1,998})>/g)) out.push(m[1]!.toLowerCase());
  return out;
};

/** Prefixes that mark a reply or a forward in the languages people write most (Re, Aw, Sv, Vs, Res, Odp, Antw; forwards: Fw, Fwd, Wg, Tr, Enc, Rv, Vb). */
const PREFIX = /^\s*(?:re|aw|sv|vs|res|odp|antw)\s*(?:\[\d+\])?\s*:\s*/i;
const FORWARD = /^\s*(?:fwd?|wg|tr|enc|rv|vb)\s*:\s*/i;

/** Whether the subject starts like a reply ("Re: ..."; a forward is not a reply). */
export const isReplySubject = (subject: string) => PREFIX.test(subject);

/** The subject without reply and forward prefixes (however many), lower case, spaces collapsed. */
export const normalizeSubject = (subject: string) => {
  let s = subject;
  for (let i = 0; i < 20; i++) {
    const next = s.replace(PREFIX, "").replace(FORWARD, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
};

/** The subject as a person reads a conversation's title: reply and forward prefixes removed, the case kept. */
export const baseSubject = (subject: string) => {
  let s = subject;
  for (let i = 0; i < 20; i++) {
    const next = s.replace(PREFIX, "").replace(FORWARD, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
};

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    for (let p = this.parent.get(root)!; p !== root; p = this.parent.get(root)!) root = p;
    // Path compression.
    for (let cur = x; cur !== root;) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const time = (m: ThreadMessage) => (Number.isFinite(m.time) ? m.time : 0);

/**
 * The conversations of a set of messages, each oldest message first; the conversations themselves are in no promised order
 * (the caller sorts them by what it knows, such as the newest uid).
 */
export function groupConversations<T extends ThreadMessage>(messages: readonly T[]): T[][] {
  const uf = new UnionFind();
  // A message is a node of its own (its key); an id is a node too, so messages meet through the ids they share.
  const idNode = (id: string) => `id:${id}`;
  const msgNode = (m: T) => `m:${m.key}`;
  for (const m of messages) {
    uf.find(msgNode(m));
    if (m.messageId) uf.union(msgNode(m), idNode(m.messageId.toLowerCase()));
    for (const id of m.inReplyTo) uf.union(msgNode(m), idNode(id.toLowerCase()));
    for (const id of m.references) uf.union(msgNode(m), idNode(id.toLowerCase()));
  }

  // The fallback: a "Re:" message with no reference headers, oldest first so one join can feed the next.
  const orphans = messages
    .filter(
      (m) => isReplySubject(m.subject) && m.inReplyTo.length === 0 && m.references.length === 0,
    )
    .sort((a, b) => time(a) - time(b) || a.key.localeCompare(b.key));
  const bySubject = new Map<string, T[]>();
  for (const m of messages) {
    const s = normalizeSubject(m.subject);
    if (!s) continue;
    const list = bySubject.get(s);
    if (list) list.push(m);
    else bySubject.set(s, [m]);
  }
  for (const o of orphans) {
    const s = normalizeSubject(o.subject);
    if (!s) continue;
    const own = uf.find(msgNode(o));
    let best: T | undefined;
    let bestScore = Infinity;
    for (const c of bySubject.get(s) ?? []) {
      if (c === o || uf.find(msgNode(c)) === own) continue;
      const gap = time(o) - time(c);
      if (Math.abs(gap) > THREAD_FALLBACK_DAYS * DAY) continue;
      // The nearest message before the reply wins; one that is after it only when nothing came before.
      const score = gap >= 0 ? gap : DAY * 1000 - gap;
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (best) uf.union(msgNode(o), msgNode(best));
  }

  const groups = new Map<string, T[]>();
  for (const m of messages) {
    const root = uf.find(msgNode(m));
    const g = groups.get(root);
    if (g) g.push(m);
    else groups.set(root, [m]);
  }
  return [...groups.values()].map((g) =>
    g.sort((a, b) => time(a) - time(b) || a.key.localeCompare(b.key)),
  );
}
