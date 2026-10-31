import { STATUS_LABEL, type DiscussionListItem, type DiscussionStatus } from "./discussions-api";

const ACTIVE: readonly DiscussionStatus[] = ["open", "paused", "stalled"];

/** The sidebar's two lists: rooms people work in, and the Chief's help and permission rooms that solve a bot's issue. Closed rooms are not listed. */
export function groupRooms(list: readonly DiscussionListItem[]) {
  const active = list.filter((d) => ACTIVE.includes(d.status));
  return {
    // By name, not by activity: a row that moves each time a bot answers is hard to click.
    rooms: active
      .filter((d) => d.kind === "room")
      .sort((a, z) => a.title.localeCompare(z.title, undefined, { sensitivity: "base" })),
    issues: active
      .filter((d) => d.kind !== "room")
      .sort((a, z) => z.updatedAt.localeCompare(a.updatedAt)),
  };
}

export type RoomSignal = "needs-you" | "working" | "paused" | "idle";

/** What a row shows about a room: the user's attention first, then bot activity. */
export function roomSignal(d: DiscussionListItem): RoomSignal {
  if (d.awaitingApproval || d.status === "stalled") return "needs-you";
  if (d.status === "paused") return "paused";
  return d.running || d.queued > 0 ? "working" : "idle";
}

/** The words on a row. An open room that is quiet says nothing. */
export function roomStatus(d: DiscussionListItem): string {
  if (d.status === "open")
    return d.awaitingApproval ? "Waiting for you" : d.running ? "Bot working…" : "";
  return STATUS_LABEL[d.status];
}

/** A help room's title starts with "Help: "; its kind already says so. */
export const roomLabel = (d: Pick<DiscussionListItem, "kind" | "title">) =>
  d.kind === "help" ? d.title.replace(/^Help: /, "") : d.title;
