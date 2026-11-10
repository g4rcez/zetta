/**
 * "Stop" said in words. A person who types "stop" or "para" while a bot works means the Stop button, not a new request to queue behind
 * the work. This is a closed list matched against the WHOLE message, so a sentence that merely contains the word ("stop the dev server
 * and restart it", "para o João revisar") is never taken for it. No model call: it runs on every message sent to a busy chat.
 */

const PHRASES = new Set([
  // English
  "stop",
  "stop it",
  "stop that",
  "stop now",
  "stop this",
  "stop everything",
  "stop all",
  "stop working",
  "stop the work",
  "stop what you are doing",
  "stop what youre doing",
  "cancel",
  "cancel it",
  "cancel that",
  "cancel this",
  "cancel everything",
  "abort",
  "abort it",
  "halt",
  "never mind",
  "nevermind",
  "forget it",
  "forget that",
  "enough",
  "thats enough",
  "that is enough",
  // Brazilian Portuguese (accents are removed before the match)
  "para",
  "pare",
  "parar",
  "para ai",
  "pare ai",
  "para agora",
  "pare agora",
  "para isso",
  "pare isso",
  "para com isso",
  "pare com isso",
  "para tudo",
  "pare tudo",
  "pode parar",
  "pode parar agora",
  "pode parar tudo",
  "cancela",
  "cancele",
  "cancelar",
  "cancela isso",
  "cancele isso",
  "cancela tudo",
  "cancele tudo",
  "pode cancelar",
  "chega",
  "ja chega",
  "esquece",
  "esqueca",
  "esquece isso",
  "esqueca isso",
  "deixa pra la",
  "deixa para la",
  "deixa quieto",
  "aborta",
  "abortar",
]);
/**
 * Words that only soften the request, at either end: "please stop", "para, por favor", "ok stop". Never a negation: "não para" and
 * "don't stop" ask for the opposite.
 */
const POLITE =
  /^(?:(?:please|pls|plz|ok|okay|hey|por favor|pfv|pfvr|opa|ei)\s+)+|(?:\s+(?:please|pls|plz|now|por favor|pfv|pfvr|agora|ai|obrigado|obrigada|thanks|thank you))+$/g;
/** A bot mention at the start: `[@Name](bot:uuid)` or `@name`. */
const MENTION = /^(?:\[@[^\]]{1,80}\]\(bot:[0-9a-f-]{36}\)|@[\p{L}\p{N}_.-]{1,60})[\s,:]*/u;

/** Longest text worth checking: every phrase is short, and a long message is a request, not a stop. */
const MAX_LENGTH = 60;

export function normalizeStop(text: string): string {
  return text
    .trim()
    .replace(MENTION, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the whole message asks the bot to stop what it is doing. */
export function asksToStop(text: string): boolean {
  // The mention does not count toward the length: a bot's name can be long.
  if (!text || text.trim().replace(MENTION, "").length > MAX_LENGTH) return false;
  let t = normalizeStop(text);
  if (PHRASES.has(t)) return true;
  // Peel the polite words off both ends, then look again ("ok, please stop now" -> "stop").
  for (let i = 0; i < 3; i++) {
    const next = t.replace(POLITE, "").trim();
    if (next === t) break;
    t = next;
    if (PHRASES.has(t)) return true;
  }
  return false;
}
