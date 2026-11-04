/**
 * Topic names of the live channel (`GET /api/events`). A topic only says "this changed": it carries no data, so the web app asks
 * the normal read route again and that route keeps deciding who may see what.
 */
export const topics = {
  conversations: "conversations",
  conversation: (id: string) => `conversation:${id}`,
  rooms: "rooms",
  discussion: (id: string) => `discussion:${id}`,
  botStatus: "bot-status",
  bots: "bots",
  attention: "attention",
  routines: "routines",
  proposals: "proposals",
  /** Events may have been missed (a server link dropped, or the stream reconnected): refetch what is on screen. */
  resync: "resync",
} as const;
