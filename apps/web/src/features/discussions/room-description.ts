/** The words people read about a room: its goal (what the room is for) and the details and references the bots read. */
export const GOAL_LABEL = "What this room is for";
export const CONTEXT_LABEL = "Details and references (bots read this)";
export const NEW_ROOM_MORE_LABEL = "More about this room (optional)";

/**
 * The first line of a goal as plain text for the header: the first line that has words, with the Markdown marks that would show as
 * noise taken out (a link is its label, so a mention reads `@Dev`, not `[@Dev](bot:…)`), cut to `max` characters.
 */
export function goalLine(goal: string, max = 160): string {
  const line =
    goal
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^(```|~~~)/.test(l)) ?? "";
  const plain = line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^(#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}

/** Whether a person may change the room's words: it must be open and theirs (a team member only reads it). */
export function canEditRoom(room: { status: string }, isOwner: boolean): boolean {
  return isOwner && room.status !== "resolved" && room.status !== "cancelled";
}
