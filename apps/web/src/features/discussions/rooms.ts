import { STATUS_LABEL, type DiscussionListItem, type DiscussionStatus } from "./discussions-api";

const ACTIVE: readonly DiscussionStatus[] = ["open", "paused", "stalled"];

/** The sidebar's two lists: rooms people work in, and the Chief's help and permission rooms that solve a bot's issue. Closed rooms and bot rooms are not listed. */
export function groupRooms(list: readonly DiscussionListItem[]) {
  const active = list.filter((d) => ACTIVE.includes(d.status));
  return {
    // By name, not by activity: a row that moves each time a bot answers is hard to click.
    rooms: active
      .filter((d) => d.kind === "room")
      .sort((a, z) => a.title.localeCompare(z.title, undefined, { sensitivity: "base" })),
    // A bot room is hidden from the sidebar: the person made the rooms in it, and a bot opens one only for something rare.
    issues: active
      .filter((d) => d.kind === "help" || d.kind === "permissions")
      .sort((a, z) => z.updatedAt.localeCompare(a.updatedAt)),
  };
}

/** Rooms in the person's sidebar order; a room they never placed keeps its place by name, after the ranked ones. */
export function orderRooms<R extends { id: string }>(
  rooms: readonly R[],
  order: readonly string[],
) {
  const rank = (r: R) => {
    const i = order.indexOf(r.id);
    return i < 0 ? Infinity : i;
  };
  // Array.sort is stable, so unplaced rooms stay in the order they came in (by name).
  return [...rooms].sort((a, z) => rank(a) - rank(z));
}

export type RoomSignal = "needs-you" | "working" | "queued" | "paused" | "idle";

/** What a row shows about a room: the user's attention first, then bot activity. Only a running turn is "working"; turns that wait their turn are "queued". */
export function roomSignal(d: DiscussionListItem): RoomSignal {
  if (d.awaitingApproval || d.status === "stalled") return "needs-you";
  if (d.status === "paused") return "paused";
  if (d.running) return "working";
  return d.queued > 0 ? "queued" : "idle";
}

/** The words on a row. An open room that is quiet says nothing. */
export function roomStatus(d: DiscussionListItem): string {
  if (d.status === "open") {
    if (d.awaitingApproval) return "Waiting for you";
    if (d.running) return "Bot working…";
    return d.queued > 0 ? "Waiting for a turn" : "";
  }
  return STATUS_LABEL[d.status];
}

/** A help room's title starts with "Help: "; its kind already says so. */
export const roomLabel = (d: Pick<DiscussionListItem, "kind" | "title">) =>
  d.kind === "help" ? d.title.replace(/^Help: /, "") : d.title;
