/**
 * Did the person ask to keep something? Used for memory, instruction and memory writes in a turn where the bot could have read outside text
 * (code access or MCP servers), which the server cannot see: only a request in the user's own message lets such a write apply at once.
 * Anything else becomes a proposal the user approves. A miss costs one click; a false hit needs an injected page and a message that
 * already talks about saving, so the match is deliberately wide rather than exact.
 */
const KEEP =
  /\b(remember|memori[sz]e|save|store|note\b|keep in mind|from now on|going forward|always|never|learn|write (it|that|this) down|add (it|that|this) to|update (the )?(wiki|memory|notes?)|document|lembr|memoriz|salv|anot|guard|daqui (pra|para) (frente|diante)|a partir de agora|sempre|nunca|aprend|registr|documente|recuerd|apunt|desde ahora|siempre)/i;

export const asksToKeep = (userMessage: string) => KEEP.test(userMessage);

/**
 * Did the person ask for a room? Rooms belong to the person: a bot opens a visible one only when their own message asked for it
 * ("open a room with Dev", "abre uma sala", "crea una sala"). Anything else a bot opens by itself is a hidden bot room. The match is wide
 * on purpose: a miss only makes the room hidden, and the room is still reachable from the chat that opened it.
 */
const ROOM =
  /\b(rooms?|salas?|sal[oó]n|discuss(ion|[aã]o)|discuss[oõ]es|group chat|chat (de|em) grupo)\b/i;

export const asksForRoom = (userMessage: string) => ROOM.test(userMessage);
