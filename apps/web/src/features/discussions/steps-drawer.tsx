import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@zetta/ui/lib/utils";
import { BotIdentity } from "@/components/bot-identity";
import { Drawer } from "@/components/drawer";
import { Response } from "../chat/response";
import type { DiscussionTurn, RoomTask, RoomTurn, TurnStep } from "./discussions-api";

const ICON: Record<TurnStep["kind"], LucideIcon> = {
  activity: Loader2,
  computer: MonitorSmartphone,
  tool: Wrench,
  post: MessageSquare,
  report: CheckCircle2,
  error: AlertTriangle,
};
const TURN_LABEL: Record<DiscussionTurn["status"], string> = {
  queued: "Waiting",
  awaiting_approval: "Needs your approval",
  running: "Working",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
};
const TASK_CLASS: Record<RoomTask["status"], string> = {
  backlog: "bg-muted text-muted-foreground",
  in_progress: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  blocked: "bg-destructive/15 text-destructive",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const seconds = (a: string, b: string | null) =>
  b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)) : undefined;

/** What one bot did in the room: a timeline per turn (oldest turn first) and the tasks it owns. */
export function StepsDrawer({
  bot,
  role,
  turns,
  tasks,
  onClose,
}: {
  bot: Parameters<typeof BotIdentity>[0]["bot"];
  role: string;
  turns: RoomTurn[];
  tasks: RoomTask[];
  onClose: () => void;
}) {
  return (
    <Drawer
      open
      onClose={onClose}
      title={<BotIdentity bot={bot} size={40} sub={role} />}
      description={role || "Steps this bot took in the room"}
    >
      <div className="space-y-6">
        <section aria-label="Tasks" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Tasks</h3>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          ) : (
            <ul className="space-y-1">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm"
                >
                  <span className="truncate">{t.title}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                      TASK_CLASS[t.status],
                    )}
                  >
                    {t.status.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">This bot has not worked in the room yet.</p>
        )}
        {[...turns].reverse().map((turn, i) => {
          const took = seconds(turn.createdAt, turn.finishedAt);
          return (
            <section key={turn.id} aria-label={`Turn ${i + 1}`} className="space-y-2">
              <h3 className="flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
                <span>
                  Turn {i + 1} · {TURN_LABEL[turn.status]}
                </span>
                {took !== undefined && <span className="font-normal normal-case">{took}s</span>}
              </h3>
              {turn.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No steps saved for this turn.</p>
              ) : (
                <ol className="relative space-y-3 border-l pl-5">
                  {turn.steps.map((s, j) => {
                    const Icon = ICON[s.kind] ?? Circle;
                    return (
                      <li key={j} className="relative text-sm">
                        <span
                          className={cn(
                            "absolute -left-[1.85rem] grid size-5 place-items-center rounded-full border bg-background",
                            s.kind === "error" && "text-destructive",
                          )}
                        >
                          <Icon className="size-3" aria-hidden="true" />
                        </span>
                        <p className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{s.label}</span>
                          <time className="shrink-0 text-xs text-muted-foreground" dateTime={s.at}>
                            {time(s.at)}
                          </time>
                        </p>
                        {s.detail &&
                          (s.kind === "post" ? (
                            <Response text={s.detail} className="mt-1 text-muted-foreground" />
                          ) : (
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {s.detail}
                            </p>
                          ))}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
