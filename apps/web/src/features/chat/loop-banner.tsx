import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Repeat, Square } from "lucide-react";

import { Button } from "@zetta/ui/components/button";
import { cn } from "@zetta/ui/lib/utils";

import { errorMessage, loopsOf, setLoop, type GoalLoop } from "./chat-client";

/**
 * The conversation's goal loop, if any: polls while one is running or paused so each new step shows up, and calls `onStep` on every poll
 * of a running loop (the chat reattaches to the step the server started) and whenever the loop moved on (the chat reloads its messages).
 */
export function useGoalLoop(
  conversationId: string | undefined,
  onTick: () => void,
  onChanged: () => void,
) {
  const [loop, setLoopState] = useState<GoalLoop>();
  const handlers = useRef({ onTick, onChanged });
  handlers.current = { onTick, onChanged };
  useEffect(() => {
    setLoopState(undefined);
    if (!conversationId) return;
    let stop = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      last = "";
    const poll = async () => {
      const latest = await loopsOf(conversationId)
        .then((l) => l[0])
        .catch(() => undefined);
      if (stop) return;
      setLoopState(latest);
      const key = latest ? `${latest.status}:${latest.iterations}:${latest.updatedAt}` : "";
      if (last && key !== last) handlers.current.onChanged();
      last = key;
      if (latest?.status === "running") handlers.current.onTick();
      const active = latest?.status === "running" || latest?.status === "paused";
      timer = setTimeout(() => void poll(), active ? 3_000 : 20_000);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [conversationId]);
  return { loop, update: setLoopState };
}

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
  onChange,
  onError,
}: {
  loop: GoalLoop | undefined;
  onChange: (loop: GoalLoop) => void;
  onError: (message: string) => void;
}) {
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
  return (
    <div
      role="status"
      aria-label={LABEL[loop.status]}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
        running && "border-primary/30 bg-primary/5",
        loop.status === "paused" && "border-amber-500/40 bg-amber-500/5",
        loop.status === "done" && "border-emerald-500/30 bg-emerald-500/5",
      )}
    >
      <span className="shrink-0 text-muted-foreground">
        {running ? (
          <Loader2 className="size-4 animate-spin" />
        ) : loop.status === "paused" ? (
          <Pause className="size-4" />
        ) : (
          <Repeat className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {LABEL[loop.status]} · step {Math.max(loop.iterations, running ? loop.iterations + 1 : 0)}
          <span className="font-normal text-muted-foreground"> · {loop.goal}</span>
        </p>
        {(loop.reason || loop.progress) && (
          <p className="truncate text-xs text-muted-foreground">
            {loop.status === "paused" && loop.reason ? loop.reason : loop.progress}
          </p>
        )}
      </div>
      {loop.status === "paused" && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("resume")}>
          <Play /> Resume
        </Button>
      )}
      {(running || loop.status === "paused") && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("stop")}>
          <Square /> Stop
        </Button>
      )}
    </div>
  );
}
