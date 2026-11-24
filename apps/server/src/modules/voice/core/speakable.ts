/**
 * From the bot's streamed text to what can be read aloud, sentence by sentence. Pure: text in, sentences out.
 *
 * Dropped: fenced code blocks (any fence, so `zetta:*` blocks and tool blocks go too), tool tags, tables, inline code, and the marks of
 * Markdown. Links say their text; a bare address says its domain. A sentence is released as soon as it ends, so the first one is spoken
 * while the bot is still writing the rest.
 */

/** Words ending in a full stop that do not end a sentence (compared in lower case, accents kept, internal dots kept). */
const ABBREVIATIONS = new Set([
  // English
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "approx",
  "inc",
  "ltd",
  "fig",
  "p.m",
  "a.m",
  "u.s",
  "u.k",
  "capt",
  // Portuguese
  "sra",
  "srta",
  "dra",
  "profa",
  "av",
  "ex",
  "p.ex",
  "ltda",
  "cia",
  "obs",
  "pág",
  "pag",
  "art",
  "cap",
  "ref",
  "tel",
  "nº",
  "s.a",
  "dep",
  // Spanish
  "ud",
  "uds",
  "vd",
  "vds",
  "ej",
  "p.ej",
  "núm",
  "num",
  "c.p",
  "pp",
  "dpto",
  "admón",
]);

const CLOSERS = `"')]}”’»`;
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** The domain of an address, without `www.`; the word "link" when it cannot be read. */
function sayAddress(raw: string): string {
  const trimmed = raw.replace(/[.,;:!?)\]]+$/, "");
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      .hostname;
    return host.replace(/^www\./, "") || "link";
  } catch {
    return "link";
  }
}

/** One finished piece of text to what is spoken: no code, no marks, addresses as their domain. May return an empty string. */
export function cleanForSpeech(raw: string): string {
  let t = raw;
  t = t.replace(/`[^`]*`/g, " ");
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_m, text: string, url: string) => {
    // A link whose text is its own address says the domain; otherwise it says its text.
    return /^(https?:\/\/|www\.)/i.test(text.trim()) ? sayAddress(url || text) : text;
  });
  t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, (m) => {
    const tail = /[.,;:!?]+$/.exec(m)?.[0] ?? "";
    return sayAddress(m) + tail;
  });
  t = t.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^\s{0,3}>+\s?/, "");
  t = t.replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, "");
  t = t.replace(/(\*\*|__|~~)/g, "");
  t = t.replace(/(^|\s)[*_]+(?=\S)/g, "$1").replace(/(?<=\S)[*_]+(?=\s|$|[.,;:!?])/g, "");
  t = t.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "");
  t = t
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : "";
}

/** Whether the `.` at `i` (followed by a space) ends a sentence, given the text before it. */
function periodEnds(text: string, i: number): boolean {
  // A list number at the start of a line ("1. first").
  if (/(^|\n)\s*\d{1,3}$/.test(text.slice(0, i))) return false;
  let s = i;
  while (s > 0 && /[\p{L}.]/u.test(text[s - 1]!)) s--;
  const word = text.slice(s, i).toLowerCase();
  if (!word) return true;
  if (ABBREVIATIONS.has(word)) return false;
  // An initial ("J. Smith") when it stands alone.
  if (word.length === 1 && /\p{Lu}/u.test(text[s]!) && (s === 0 || isSpace(text[s - 1])))
    return false;
  return true;
}

/**
 * Finds the first sentence end in `text` and returns its index (the cut after it, closing quotes included), or -1. A terminator ends a
 * sentence only when a space follows; "3.5" and "example.com" never do. Boundaries inside inline code are not boundaries. A
 * terminator at the very end waits for the next character, unless `final`.
 */
function findCut(text: string, final: boolean): number {
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "`") {
      inCode = !inCode;
      continue;
    }
    if (inCode || !(c === "." || c === "!" || c === "?" || c === "…")) continue;
    let end = i + 1;
    while (end < text.length && /[.!?…]/.test(text[end]!)) end++;
    while (end < text.length && CLOSERS.includes(text[end]!)) end++;
    if (end >= text.length) return final ? end : -1;
    if (!isSpace(text[end])) {
      i = end - 1;
      continue;
    }
    if (c === "." && end === i + 1 && !periodEnds(text, i)) continue;
    // "Well... maybe": an ellipsis followed by a lower case word goes on.
    if ((c === "\u2026" || end - i >= 3) && /^\s*\p{Ll}/u.test(text.slice(end))) {
      i = end - 1;
      continue;
    }
    return end;
  }
  return -1;
}

const FENCE = /^\s*(```|~~~)/;
const TOOL_OPEN = /^\s*<(tool_use|tool_call|tool_result|function_calls|antml:[a-z_]+)\b/i;

/**
 * The streaming filter. `push` takes the next piece of the bot's text and returns the sentences that are now complete; `flush` at the end
 * of the reply returns the rest. Lines are judged as they arrive: a line that opens a code fence or a table is held back until its
 * newline, any other line streams into the sentence finder at once.
 */
export class SpeakableStream {
  private line = "";
  /** Where the current line stands: not decided yet, plain text, or a line that is dropped whole. */
  private mode: "undecided" | "text" | "dropped" = "undecided";
  private fence: string | null = null;
  private tag: string | null = null;
  private sentence = "";

  push(delta: string): string[] {
    const out: string[] = [];
    let at = 0;
    while (at < delta.length) {
      const nl = delta.indexOf("\n", at);
      const piece = nl === -1 ? delta.slice(at) : delta.slice(at, nl);
      this.add(piece, out);
      if (nl === -1) break;
      this.endLine(out);
      at = nl + 1;
    }
    return out;
  }

  /** The reply is over: what is left is spoken, an unclosed code block is not. */
  flush(): string[] {
    const out: string[] = [];
    if (this.line || this.mode === "text") this.endLine(out);
    if (this.fence === null && this.tag === null) this.cut(out, true);
    this.reset();
    return out;
  }

  /** Forgets everything held (the reply was interrupted). */
  reset() {
    this.line = "";
    this.mode = "undecided";
    this.fence = null;
    this.tag = null;
    this.sentence = "";
  }

  private add(piece: string, out: string[]) {
    if (!piece) return;
    this.line += piece;
    if (this.fence !== null || this.tag !== null) return;
    if (this.mode === "undecided") {
      const head = this.line.trimStart();
      if (!head) return;
      const c = head[0]!;
      if (c === "|") {
        this.mode = "dropped";
        return;
      }
      // A line that may open a fence or a tool tag waits until it is clear which.
      if ((c === "`" || c === "~") && head.length < 3) return;
      if (c === "<" && head.length < 16 && !/[\s>]/.test(head)) return;
      this.decide(out);
      return;
    }
    if (this.mode === "text") {
      this.sentence += piece;
      this.cut(out, false);
    }
  }

  private decide(out: string[]) {
    const head = this.line.trimStart();
    if (/^(```|~~~)/.test(head) || head.startsWith("|") || TOOL_OPEN.test(this.line)) {
      this.mode = "dropped";
      return;
    }
    this.mode = "text";
    this.sentence += this.line;
    this.cut(out, false);
  }

  private endLine(out: string[]) {
    const line = this.line;
    if (this.fence !== null) {
      if (FENCE.test(line) && line.trim().startsWith(this.fence)) this.fence = null;
    } else if (this.tag !== null) {
      if (line.toLowerCase().includes(`</${this.tag}`)) this.tag = null;
    } else if (this.mode === "undecided") {
      // A short line ("Ok") that never reached the decision length.
      this.sentence += line;
      this.mode = "text";
    }
    if (this.fence === null && this.tag === null && this.mode === "dropped") {
      const m = FENCE.exec(line);
      const t = TOOL_OPEN.exec(line);
      if (m) this.fence = m[1]!;
      else if (t && !line.toLowerCase().includes(`</${t[1]!.toLowerCase()}`))
        this.tag = t[1]!.toLowerCase();
    }
    if (this.mode === "text") {
      // A line break ends what was being said (a paragraph, a list item, a heading).
      this.cut(out, true);
    }
    this.line = "";
    this.mode = "undecided";
  }

  private cut(out: string[], final: boolean) {
    for (;;) {
      const at = findCut(this.sentence, final);
      if (at === -1) break;
      const spoken = cleanForSpeech(this.sentence.slice(0, at));
      this.sentence = this.sentence.slice(at).trimStart();
      if (spoken) out.push(spoken);
    }
    if (final) {
      const spoken = cleanForSpeech(this.sentence);
      this.sentence = "";
      if (spoken) out.push(spoken);
    }
  }
}

/** The whole text at once: for tests, and for the "Listen" button's text. */
export function speakableSentences(text: string): string[] {
  const s = new SpeakableStream();
  return [...s.push(text), ...s.flush()];
}
