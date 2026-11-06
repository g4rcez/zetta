import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { railRow } from "@/components/rail-row";
import { cn } from "@zetta/ui/lib/utils";

import { ApiError } from "../chat/chat-client";
import { useAgentsState, usePreferences } from "../preferences/preferences";

/**
 * "Pause everything" for the signed-in person. Pausing stops the turns running now and keeps anything new from starting (messages
 * answer "paused", routines and queued messages wait); resuming lets everything go on. The state lives on the account, so every
 * device shows it.
 */
export function useToggleAgents() {
  const { setAgentsState } = usePreferences();
  const paused = useAgentsState() === "paused";
  const [busy, setBusy] = useState(false);
  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { stopped } = await setAgentsState(paused ? "running" : "paused");
      toast.success(
        paused
          ? "Agents resumed. Routines and waiting messages go on."
          : stopped
            ? `Agents paused. ${stopped} running ${stopped === 1 ? "turn was" : "turns were"} stopped.`
            : "Agents paused. Nothing new starts until you resume.",
      );
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Could not change your agents. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, paused, setAgentsState]);
  return { paused, busy, toggle };
}

/** The sidebar footer control: an icon square that shows the state (pause bars, or play while paused) and flips it. */
export function PauseAgentsButton({ collapsed }: { collapsed: boolean }) {
  const { paused, busy, toggle } = useToggleAgents();
  const label = paused ? "Resume agents" : "Pause agents";
  const Icon = paused ? PlayIcon : PauseIcon;
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-label={label}
      aria-pressed={paused}
      title={collapsed ? undefined : label}
      className={cn(
        railRow,
        !collapsed && "h-7 w-7 min-w-7",
        paused && "bg-attention/15 [&_svg]:text-attention",
      )}
    >
      <Icon className="size-4 shrink-0" weight={paused ? "fill" : "regular"} aria-hidden="true" />
    </button>
  );
}

/** Shown above the page while the agents are paused, so nobody wonders why nothing answers. */
export function PausedBanner() {
  const { paused, busy, toggle } = useToggleAgents();
  if (!paused) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-attention/10 px-4 py-2 text-sm"
    >
      <PauseIcon className="size-4 shrink-0 text-attention" weight="fill" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Your agents are paused. Nothing new starts, and routines and messages wait until you resume.
      </p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggle()}>
        Resume agents
      </Button>
    </div>
  );
}
