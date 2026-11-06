import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { userPreference, type AgentsState } from "@zetta/db/schema/preferences";

/**
 * "Pause everything": while a person's agents are `paused`, nothing of theirs starts. Every place that starts agent work asks
 * `agentsPaused` first; the chat service also stops the turns already running when the state changes (see `setAgentsState` there).
 */
export class AgentsPausedError extends Error {
  readonly code = "AGENTS_PAUSED";
  constructor() {
    super("AGENTS_PAUSED");
  }
}

/** No preference row means a person who never changed anything: running. */
export async function agentsState(db: Database, userId: string): Promise<AgentsState> {
  const [row] = await db
    .select({ state: userPreference.agentsState })
    .from(userPreference)
    .where(eq(userPreference.ownerUserId, userId));
  return row?.state ?? "running";
}

export const agentsPaused = async (db: Database, userId: string) =>
  (await agentsState(db, userId)) === "paused";

/** Throws AgentsPausedError while the person's agents are paused. */
export async function assertAgentsRunning(db: Database, userId: string) {
  if (await agentsPaused(db, userId)) throw new AgentsPausedError();
}

/** Writes the state and returns it; the caller publishes the change and stops running work. */
export async function writeAgentsState(db: Database, userId: string, state: AgentsState) {
  await db
    .insert(userPreference)
    .values({ ownerUserId: userId, agentsState: state })
    .onConflictDoUpdate({
      target: userPreference.ownerUserId,
      set: { agentsState: state, updatedAt: new Date() },
    });
  return state;
}
