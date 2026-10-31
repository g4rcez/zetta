const SECRETS = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /\b[A-Fa-f0-9]{40,}\b/,
  /(password|passwd|secret|api[_ -]?key|token)\s*(is|=|:)\s*\S{6,}/i,
];
/** True when the text looks like it contains a credential. The server never stores such text as memory or instructions; the chat composer warns before sending it. */
export const looksSecret = (text: string) => SECRETS.some((r) => r.test(text));
