/**
 * Did the person ask to keep something? Used for memory, instruction and memory writes in a turn where the bot could have read outside text
 * (code access or MCP servers), which the server cannot see: only a request in the user's own message lets such a write apply at once.
 * Anything else becomes a proposal the user approves. A miss costs one click; a false hit needs an injected page and a message that
 * already talks about saving, so the match is deliberately wide rather than exact.
 */
const KEEP =
  /\b(remember|memori[sz]e|save|store|note\b|keep in mind|from now on|going forward|always|never|learn|write (it|that|this) down|add (it|that|this) to|update (the )?(wiki|memory|notes?)|document|lembr|memoriz|salv|anot|guard|daqui (pra|para) (frente|diante)|a partir de agora|sempre|nunca|aprend|registr|documente|recuerd|apunt|desde ahora|siempre)/i;

export const asksToKeep = (userMessage: string) => KEEP.test(userMessage);
