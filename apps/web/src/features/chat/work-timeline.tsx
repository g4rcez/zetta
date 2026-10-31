import { cn } from "@zetta/ui/lib/utils";

import type { Row } from "./chat-rows";

/** "plugin postgres.db_overview" -> "Running postgres · db_overview"; other labels pass through. */
export const friendly = (activity?: string) => {
  const m = activity?.match(/^(?:plugin|mcp) ([^.\s]+)\.(\S*)$/);
  return m ? `Running ${m[1]}${m[2] ? ` · ${m[2]}` : ""}` : activity;
};

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/**
 * Status layout, not a message: what the bot did while it worked, as a mono rail with the time since the first step. Open while the
 * bot still works; once the answer is saved it folds into a one-line summary that stays in the chat.
 */
export function WorkTimeline({ row, working }: { row: Row; working: boolean }) {
  const steps = row.timeline ?? row.meta?.timeline ?? [];
  if (steps.length < 2 && !(working && steps.length)) return null;
  const first = steps[0]!.at;
  const total = steps.at(-1)!.at - first;
  return (
    <details
      open={working}
      className="group/timeline w-full max-w-prose rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 font-mono">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full bg-muted-foreground/50",
            working && "animate-pulse bg-primary",
          )}
        />
        {working ? "Working" : "Worked"} · {steps.length} steps{!working && ` · ${elapsed(total)}`}
      </summary>
      <ol
        aria-label="Work timeline"
        className="space-y-0.5 border-t border-dashed px-3 py-2 font-mono"
      >
        {steps.map((s, i) => (
          <li key={`${s.at}:${i}`} className="flex gap-3">
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground/60">
              +{elapsed(s.at - first)}
            </span>
            <span
              className={cn(
                "min-w-0 break-words",
                working && i === steps.length - 1 && "text-foreground",
              )}
            >
              {friendly(s.label)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
