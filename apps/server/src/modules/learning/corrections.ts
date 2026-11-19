/**
 * Reading a person's message for what it says about the answer before it. Pure, no imports: the outcome resolver (outcomes.ts) and the
 * old skill review (memory/skill-review.ts) both use it.
 */

const CORRECTION =
  /^\s*(no\b|nope\b|wrong\b|not (like )?that|that'?s (not|wrong)|actually\b|instead\b|i said\b|i meant\b|you should\b|don'?t\b|do not\b|stop doing\b|next time\b|from now on\b|always\b|never\b|n[aã]o[,.! ]|errado|na verdade|em vez|ao inv[eé]s|eu disse|eu quis dizer|voc[eê] deveria|n[aã]o fa[cç]a|da pr[oó]xima vez|a partir de agora|sempre\b|nunca\b)/i;

/** True when a message reads as the person correcting or steering the bot. */
export const looksLikeCorrection = (text: string) => CORRECTION.test(text);
