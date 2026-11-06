import { entityState } from "../integrations/plugins/homeassistant";
import { newMessages } from "../integrations/plugins/google/gmail";
import type { PluginContext } from "../integrations/plugins/registry";

/** What one poll found. `key` is the event's identity: the same key never starts a second run. */
export type PollResult = { events: { key: string; event: unknown }[]; cursor: unknown };
export type Poller = (userId: string, filter: unknown, cursor: unknown) => Promise<PollResult>;
export type Pollers = { gmail: Poller; home_assistant: Poller };

/**
 * A cursor older than this is not trusted: the routine was paused or the server was down, so what happened in the gap is skipped instead of
 * starting a burst of old runs. The poll just notes where things stand now.
 */
export const STALE_MS = 3_600_000;
/** The window of a Gmail poll starts this much before the last poll, so a mail Gmail indexes late is still seen. Repeats are absorbed by the run key. */
const OVERLAP_MS = 120_000;

/** Polls Gmail and Home Assistant with the owner's own plugin connections (the same clients the bot's tools use). */
export function createRoutinePollers(
  contextFor: (userId: string, pluginId: string) => Promise<PluginContext>,
): Pollers {
  return {
    async gmail(userId, filter, cursor) {
      const f = filter as { query: string; account?: string };
      const c = cursor as { at: number } | null;
      const now = Date.now();
      const ctx = await contextFor(userId, "google");
      if (!c || now - c.at > STALE_MS) return { events: [], cursor: { at: now } };
      const mails = await newMessages(ctx, f.query, (c.at - OVERLAP_MS) / 1000, f.account);
      return {
        events: mails.map((m) => ({ key: `gmail:${m.id}`, event: { source: "gmail", ...m } })),
        cursor: { at: now },
      };
    },
    async home_assistant(userId, filter, cursor) {
      const f = filter as { entityId: string; to?: string };
      const c = cursor as { at: number; state: string } | null;
      const now = Date.now();
      const s = await entityState(await contextFor(userId, "homeassistant"), f.entityId);
      const next = { at: now, state: s.state };
      if (!c || now - c.at > STALE_MS || c.state === s.state) return { events: [], cursor: next };
      if (f.to && s.state !== f.to) return { events: [], cursor: next };
      return {
        events: [
          {
            key: `ha:${f.entityId}:${s.changedAt}`,
            event: {
              source: "home_assistant",
              entityId: f.entityId,
              name: s.name,
              from: c.state,
              to: s.state,
              changedAt: s.changedAt,
            },
          },
        ],
        cursor: next,
      };
    },
  };
}
