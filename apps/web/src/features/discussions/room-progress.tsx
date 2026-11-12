import { BotIdentity, useBotIdentity } from "@/components/bot-identity";
import { Progress } from "@/components/ui";
import { relativeTime } from "@/features/shared/relative-time";

import type { Discussion } from "./discussions-api";

/** What the bar needs from a room: how far the lead said the work is, and who said it. */
export type RoomProgressFields = Pick<
  Discussion,
  "status" | "progressPercent" | "progressNote" | "progressBotId" | "progressAt"
>;

/** The percent a room shows: a resolved room is complete, whatever the lead last said. Null until the lead has reported. */
export function shownProgress(room: RoomProgressFields): number | null {
  if (room.status === "resolved") return 100;
  // A room an older server sent has no fields at all: that reads as no report too.
  return room.progressPercent == null || room.progressAt == null ? null : room.progressPercent;
}

/**
 * How far the work of a room is, as its lead last reported it (the `progress` action of `zetta:discussion`): a thin bar, the percent,
 * the lead's short note, and who said it and when. Hidden until the first report.
 */
export function RoomProgress({
  room,
  botName,
}: {
  room: RoomProgressFields;
  botName: string | undefined;
}) {
  const bot = useBotIdentity(room.progressBotId ?? "", botName ?? "The lead");
  const percent = shownProgress(room);
  if (percent === null) return null;
  return (
    <section
      aria-label="Room progress"
      className="flex items-center gap-3 border-b px-4 py-1.5 text-xs text-muted-foreground"
    >
      <Progress
        value={percent}
        label={`Room progress: ${percent}%`}
        tone={room.status === "resolved" ? "success" : "primary"}
        className="w-32 shrink-0 sm:w-56"
      />
      <span className="font-medium text-foreground tabular-nums">{percent}%</span>
      {room.progressNote ? (
        <span className="min-w-0 flex-1 truncate">{room.progressNote}</span>
      ) : null}
      {room.progressBotId && room.progressAt ? (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <BotIdentity bot={bot} size={16} className="max-w-40" />
          <time dateTime={room.progressAt}>{relativeTime(room.progressAt)}</time>
        </span>
      ) : null}
    </section>
  );
}
