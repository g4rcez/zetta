import { mentionsAsText } from "@zetta/core/mentions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pollEvery } from "@/lib/query-policy";
import { useEffect, useRef, useState } from "react";
import {
  CircleNotchIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  SquareIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";

import { errorMessage, setLoop, type GoalLoop } from "./chat-client";
import { chatQueries } from "./chat-queries";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime } from "@/features/preferences/time-format";

/**
 * The conversation's goal loop, if any: polls while one is running or paused so each new step shows up, and calls `onStep` on every poll
 * of a running loop (the chat reattaches to the step the server started) and whenever the loop moved on (the chat reloads its messages).
 */
export function useGoalLoop(
  conversationId: string | undefined,
  onTick: () => void,
  onChanged: () => void,
) {
  const qc = useQueryClient();
  const key = chatQueries.loops(conversationId ?? "").queryKey;
  const query = useQuery({
    ...chatQueries.loops(conversationId ?? ""),
    enabled: !!conversationId,
    // Each new step shows up while a loop is running or paused. A loop that starts elsewhere shows up on the slow poll.
    refetchInterval: (q) =>
      pollEvery(
        3_000,
        60_000,
        !!q.state.data?.some((l) => l.status === "running" || l.status === "paused"),
      ),
  });
  const all = (conversationId && query.data) || NONE;
  const handlers = useRef({ onTick, onChanged });
  handlers.current = { onTick, onChanged };
  const last = useRef("");
  useEffect(() => {
    last.current = "";
  }, [conversationId]);
  // `dataUpdatedAt` moves on every answer, so a running loop ticks on each poll even when nothing in it changed.
  useEffect(() => {
    if (!query.data) return;
    const seen = query.data
      .map((l) => `${l.id}:${l.status}:${l.iterations}:${l.updatedAt}`)
      .join("|");
    if (last.current && seen !== last.current) handlers.current.onChanged();
    last.current = seen;
    if (query.data.some((l) => l.status === "running")) handlers.current.onTick();
  }, [query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: GoalLoop) =>
    qc.setQueryData<GoalLoop[]>(key, (cur = []) =>
      cur.some((l) => l.id === next.id)
        ? cur.map((l) => (l.id === next.id ? next : l))
        : [next, ...cur],
    );
  // `loop` is the newest one (a chat has one); `loops` are the active ones (a team room has one per member).
  return {
    loop: all[0],
    loops: all.filter((l) => l.status === "running" || l.status === "paused"),
    update,
    /** Fetch the loops now, without waiting for the next poll (after the room stops its goals). */
    refresh: () => qc.invalidateQueries({ queryKey: key }),
  };
}

const NONE: GoalLoop[] = [];

const LABEL: Record<GoalLoop["status"], string> = {
  running: "Loop running",
  paused: "Loop paused",
  done: "Loop finished",
  failed: "Loop failed",
  cancelled: "Loop stopped",
};

/** Slim bar above the composer: the goal, how many steps ran, and Stop / Resume. Finished loops stay visible until the next one. */
export function LoopBanner({
  loop,
  owner,
  onChange,
  onError,
}: {
  loop: GoalLoop | undefined;
  /** A team member's name: its loop shares the room with others. */
  owner?: string | undefined;
  onChange: (loop: GoalLoop) => void;
  onError: (message: string) => void;
}) {
  const tf = useTimeFormat();
  const [busy, setBusy] = useState(false);
  if (!loop || (loop.status !== "running" && loop.status !== "paused" && loop.status !== "done"))
    return null;
  const act = async (to: "stop" | "resume") => {
    setBusy(true);
    try {
      onChange(await setLoop(loop.id, to));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const running = loop.status === "running";
  const retryAt = running && loop.retryAt ? new Date(loop.retryAt) : undefined;
  const waiting = retryAt !== undefined && retryAt > new Date();
  const label = waiting ? "Loop waiting to retry" : LABEL[loop.status];
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-[opacity,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
        running && "border-primary/30 bg-primary/5",
        loop.status === "paused" && "border-warn/40 bg-warn/5",
        loop.status === "done" && "border-success/30 bg-success/5",
      )}
    >
      <span className="shrink-0 text-muted-foreground">
        {running ? (
          <CircleNotchIcon className="size-4 animate-spin" />
        ) : loop.status === "paused" ? (
          <PauseIcon className="size-4" />
        ) : (
          <RepeatIcon className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {label} · step {Math.max(loop.iterations, running ? loop.iterations + 1 : 0)}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {owner ? `${owner}: ` : ""}
            {mentionsAsText(loop.goal)}
          </span>
        </p>
        {(loop.reason || loop.progress) && (
          <p className="truncate text-xs text-muted-foreground">
            {waiting
              ? `${loop.reason ?? "Retrying"} · next try at ${formatTime(retryAt, tf)}`
              : loop.status === "paused" && loop.reason
                ? loop.reason
                : loop.progress}
          </p>
        )}
      </div>
      {loop.status === "paused" && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("resume")}>
          <PlayIcon /> Resume
        </Button>
      )}
      {(running || loop.status === "paused") && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("stop")}>
          <SquareIcon /> Stop
        </Button>
      )}
    </div>
  );
}
