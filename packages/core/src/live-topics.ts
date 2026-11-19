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
  /** A bot's saved tests ran or changed, or a reply of it was rated: its History, Saved tests and Performance sections refetch. */
  botQuality: (botId: string) => `bot-quality:${botId}`,
  /** A bot's lessons or the reading of its chats changed (a lesson started, was kept or dropped, a reading ended): its Lessons section refetches. */
  botLearning: (botId: string) => `bot-learning:${botId}`,
  attention: "attention",
  routines: "routines",
  /** A workflow run paused, woke or ended (also by itself, on a timer or after a card was answered): the run list refetches. */
  workflows: "workflows",
  /** A task was added, changed, moved, paused or removed (also by a bot): the board, a task page and the bots' current task refetch. */
  tasks: "tasks",
  /** A project, its members or its rooms changed: the project list and pages refetch. Task changes reach them through `tasks`. */
  projects: "projects",
  /** The company chart (seats, holders, who reports to whom) changed: the Organization page refetches. */
  org: "org",
  proposals: "proposals",
  /** The person paused or resumed all their agents. */
  agents: "agents",
  /** A run of a playground started or finished, or the playground changed. */
  playground: (id: string) => `playground:${id}`,
  /** An app was published, changed or rolled back, or one of its calls started, waited for approval or finished. */
  apps: "apps",
  /** Events may have been missed (a server link dropped, or the stream reconnected): refetch what is on screen. */
  resync: "resync",
} as const;
