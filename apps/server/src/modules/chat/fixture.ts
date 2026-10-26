import type { bot } from "@zetta/db/schema/chat";

export type Responder = (input: { bot: typeof bot.$inferSelect; history: readonly { role: string; content: string }[]; prompt: string }) => Promise<string>;

/** Offline responder used when a bot's harness is "fixture". */
export const fixtureResponder: Responder = async ({ bot: b, prompt }) => `[fixture harness] ${b.name} received: ${prompt.slice(-4000)}`;
