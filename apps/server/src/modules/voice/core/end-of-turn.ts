/**
 * End of turn: when has the person finished? Silence alone is a poor guide, because people pause mid-sentence. After
 * `END_SILENCE_MS` of silence the transcript so far is looked at; if it reads as unfinished the session waits `EXTEND_MS` more. Only one
 * extension per pause, so a person who really stopped waits at most 1.2 seconds.
 */
export const END_SILENCE_MS = 700;
export const EXTEND_MS = 500;

/**
 * Words a sentence does not end on, in English, Portuguese and Spanish: connectives, articles, prepositions and possessives. Words that
 * can end a sentence ("so", "you", "no", "then") are left out on purpose. Compared in lower case without accents.
 */
const CONNECTIVES = new Set([
  // English
  "and",
  "or",
  "but",
  "because",
  "if",
  "when",
  "while",
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "than",
  "the",
  "a",
  "an",
  "to",
  "of",
  "for",
  "with",
  "in",
  "on",
  "at",
  "by",
  "from",
  "about",
  "into",
  "my",
  "your",
  "our",
  "their",
  "his",
  "its",
  "i",
  "we",
  "they",
  "as",
  "uh",
  "um",
  "hmm",
  // Portuguese
  "e",
  "ou",
  "mas",
  "porem",
  "porque",
  "pois",
  "se",
  "quando",
  "enquanto",
  "que",
  "qual",
  "quem",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "pra",
  "pro",
  "com",
  "em",
  "na",
  "nas",
  "por",
  "pelo",
  "pela",
  "sobre",
  "o",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "meu",
  "minha",
  "seu",
  "sua",
  "como",
  "ao",
  "aos",
  "eh",
  // Spanish
  "y",
  "pero",
  "sino",
  "aunque",
  "cuando",
  "mientras",
  "donde",
  "del",
  "al",
  "la",
  "las",
  "el",
  "los",
  "con",
  "sin",
  "unos",
  "unas",
  "mi",
  "tu",
  "su",
  "pues",
]);

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const lastWord = (t: string) =>
  strip(
    t
      .replace(/[.!?"')\]\u201d\u00bb,;:\u2026-]+$/, "")
      .split(/\s+/)
      .pop() ?? "",
  );

/**
 * True when the text reads as a sentence that is not finished. Empty text is not (nothing was said). A question is finished. Otherwise
 * it is unfinished when it ends on a comma, colon, dash or ellipsis, when it has no final punctuation (a recognizer punctuates what it
 * hears as complete), or when its last word is a connective: recognizers add a full stop even after a trailing "and".
 */
export function looksUnfinished(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/(\.\.\.|\u2026|[,;:\u2014-])["')\]]*$/.test(t)) return true;
  if (/\?["')\]\u201d\u00bb]*$/.test(t)) return false;
  if (!/[.!\u3002]["')\]\u201d\u00bb]*$/.test(t)) return true;
  return CONNECTIVES.has(lastWord(t));
}

/** The silence needed after a pause, given what was heard so far: 700 ms, or 1200 ms when it looks unfinished. */
export const silenceNeeded = (transcript: string) =>
  END_SILENCE_MS + (looksUnfinished(transcript) ? EXTEND_MS : 0);
