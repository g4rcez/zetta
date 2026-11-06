import type { Row } from "../chat/chat-rows";

/**
 * A room runs several bots at once and every turn has its own stream on the server. The page follows each running turn with its
 * own chat, so a turn that starts or ends never touches the live row of another one.
 */
export type StreamState = {
  busy: boolean;
  rows: Row[];
  error?: Error | undefined;
  clearError?: (() => void) | undefined;
};
export type TurnLite = { id: string; status: string; createdAt: string };

/**
 * Most streams followed at once. The server speaks HTTP/1.1, so the browser keeps 6 connections per host: each followed turn holds
 * one open GET, the events channel holds another and the polls need the rest. A turn past the cap still shows through the poll.
 */
export const MAX_FOLLOWED = 3;

const hasRows = (s: StreamState | undefined) => (s?.rows.length ?? 0) > 0;

/**
 * The turns to follow after a change. A followed turn stays while it runs, while its stream is busy and while it still holds live
 * rows: a turn that ends in the database must not drop its row before the saved message has replaced it. New running turns join
 * oldest first, up to `max` streams that are really live.
 */
export function nextFollowed(
  prev: readonly string[],
  turns: readonly TurnLite[],
  states: ReadonlyMap<string, StreamState>,
  max = MAX_FOLLOWED,
): string[] {
  const byId = new Map(turns.map((t) => [t.id, t]));
  const isLive = (id: string) =>
    byId.get(id)?.status === "running" || Boolean(states.get(id)?.busy);
  const kept = prev.filter((id) => isLive(id) || hasRows(states.get(id)));
  const next = new Set(kept);
  let live = kept.filter(isLive).length;
  const joining = turns
    .filter((t) => t.status === "running" && !next.has(t.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const t of joining) {
    if (live >= max) break;
    next.add(t.id);
    live++;
  }
  const out = [...next];
  return out.length === prev.length && out.every((id, i) => id === prev[i])
    ? (prev as string[])
    : out;
}

/** Ids of the turns whose stream is open right now. */
export const busyIds = (states: ReadonlyMap<string, StreamState>) =>
  [...states].filter(([, s]) => s.busy).map(([id]) => id);

/**
 * The live streams already show everything that is going on, so the room can poll slowly. A queued turn, or a running turn without
 * an open stream, keeps the fast poll: its start or its text reaches the page only through it.
 */
export function coveredRoom(
  turns: readonly TurnLite[],
  states: ReadonlyMap<string, StreamState>,
): boolean {
  if (busyIds(states).length === 0) return false;
  return turns
    .filter((t) => t.status === "running" || t.status === "queued")
    .every((t) => t.status === "running" && states.get(t.id)?.busy);
}
