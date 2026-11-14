import {
  CaretRightIcon,
  CheckIcon,
  CircleIcon,
  CircleNotchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@zetta/ui/lib/utils";

import type { Message, PlanStep } from "./chat-client";
import type { Row } from "./chat-rows";
import { StepOutput } from "./step-output";

/** "plugin notion.search" -> "Running notion · search"; other labels pass through. */
export const friendly = (activity?: string) => {
  const m = activity?.match(/^(?:plugin|mcp) ([^.\s]+)\.(\S*)$/);
  return m ? `Running ${m[1]}${m[2] ? ` · ${m[2]}` : ""}` : activity;
};

/**
 * No concrete step: nothing yet, "Thinking", or the server's "Still working" after a silence (which may name the last step). The
 * status line then runs a real timer from the start of the reply.
 */
export const isGeneric = (activity?: string) =>
  !activity || activity === "Thinking" || activity.startsWith("Still working");

export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** Current time, refreshed every second while `active`; the interval stops when it turns false or on unmount. */
export const useNow = (active: boolean) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
};

export type StepState = "done" | "running" | "failed" | "pending";

/** Every step before the last one is done. The last one runs while the bot works, fails when the reply failed or stopped, else is done. */
export const stepStates = (
  count: number,
  working: boolean,
  status?: Message["status"],
): StepState[] =>
  Array.from({ length: count }, (_, i) =>
    i < count - 1
      ? "done"
      : working
        ? "running"
        : status === "failed" || status === "interrupted"
          ? "failed"
          : "done",
  );

/**
 * States for a plan the bot announced. `active` runs while the bot works; after the turn it is done (the bot may forget the last
 * update), failed when the reply failed, and still open when the user stopped it. `pending` stays pending.
 */
export const planStates = (
  steps: PlanStep[],
  working: boolean,
  status?: Message["status"],
): StepState[] =>
  steps.map((s) =>
    s.status !== "active"
      ? s.status
      : working
        ? "running"
        : status === "failed" || status === "interrupted"
          ? "failed"
          : status === "cancelled"
            ? "pending"
            : "done",
  );

/** "Step 2 of 3": the first step that is not done, or the last one when all are. */
export const planProgress = (steps: PlanStep[]) => {
  const next = steps.findIndex((s) => s.status !== "done");
  return `Step ${next < 0 ? steps.length : next + 1} of ${steps.length}`;
};

const STATE_NAME: Record<StepState, string> = {
  done: "Done",
  running: "Running",
  failed: "Failed",
  pending: "Not started",
};

function StepIcon({ state }: { state: StepState }) {
  const base = "size-3.5";
  return (
    <span className="flex size-4 items-center justify-center">
      {state === "done" && (
        <CheckIcon aria-hidden="true" weight="bold" className={cn(base, "text-primary")} />
      )}
      {state === "running" && (
        <CircleNotchIcon
          aria-hidden="true"
          className={cn(base, "animate-spin text-primary motion-reduce:animate-none")}
        />
      )}
      {state === "pending" && (
        <CircleIcon aria-hidden="true" className={cn(base, "text-muted-foreground/60")} />
      )}
      {state === "failed" && (
        <WarningCircleIcon
          aria-hidden="true"
          weight="fill"
          className={cn(base, "text-destructive")}
        />
      )}
      <span className="sr-only">{STATE_NAME[state]}: </span>
    </span>
  );
}

type Item = {
  key: string;
  label: string;
  /** A command of the running turn: click it to watch what it prints. */
  stepId?: string | undefined;
  state: StepState;
  detail?: string | undefined;
  time?: string | undefined;
};

/** The label of a command step as a button: it opens the live output under it. Text, so it needs no hint. */
function StepToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="cursor-pointer text-left underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {label}
    </button>
  );
}

/**
 * Status layout, not a message: what the bot did while it worked, as a rail of steps with a status icon. It is one quiet line that
 * opens on click: while the bot works the line names what it is doing now, with a live clock; once the answer is saved it says
 * "Worked · 6 steps · 42s" and stays in the chat. When the bot announced a plan
 * (zetta:plan) the rail is that checklist, with the live activity under the running step; otherwise it is the steps it reported, with
 * the time since the first one.
 */
export function WorkTimeline({
  row,
  working,
  stepOutputUrl,
}: {
  row: Row;
  working: boolean;
  stepOutputUrl?: ((stepId: string) => string | undefined) | undefined;
}) {
  const steps: { at: number; label: string; stepId?: string | undefined }[] =
    row.timeline ?? row.meta?.timeline ?? [];
  // One command's output is open at a time. Only a live row has step ids: a saved reply never shows output.
  const [opened, setOpened] = useState<string>();
  const plan = row.plan ?? row.meta?.plan;
  const now = useNow(working);
  // Step times come from the server clock, so the live clock adds only the client time since the last step arrived.
  const seenAt = useRef(Date.now());
  useEffect(() => {
    seenAt.current = Date.now();
  }, [steps.length]);
  // The list scrolls inside a fixed height. It follows the newest step only while the reader is at the bottom (within 8px).
  const list = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const [overflows, setOverflows] = useState(false);
  const measure = () => {
    const el = list.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight);
  };
  const itemCount = plan ? plan.length : steps.length;
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (!working) {
      el.scrollTop = 0;
      atBottom.current = true;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
    measure();
  }, [itemCount, working]);
  if (!plan && steps.length < 2 && !(working && steps.length)) return null;
  const first = steps[0]?.at ?? 0;
  const span = steps.length ? steps.at(-1)!.at - first : undefined;
  const total =
    span !== undefined
      ? working
        ? span + Math.max(0, now - seenAt.current)
        : span
      : working
        ? now - new Date(row.createdAt).getTime()
        : undefined;
  // A reply read from the saved row (no live stream attached) keeps its current activity in `meta.activity`.
  const activity = row.activity ?? row.meta?.activity;
  const live = isGeneric(activity) ? undefined : friendly(activity);
  const items: Item[] = plan
    ? planStates(plan, working, row.status).map((state, i) => ({
        key: plan[i]!.id,
        label: plan[i]!.title,
        state,
        detail: working && state === "running" ? live : undefined,
      }))
    : stepStates(steps.length, working, row.status).map((state, i) => ({
        key: `${steps[i]!.at}:${i}`,
        label: friendly(steps[i]!.label) ?? "",
        stepId: steps[i]!.stepId,
        state,
        time: `+${elapsed(steps[i]!.at - first)}`,
      }));
  const count = plan
    ? working
      ? planProgress(plan)
      : `${plan.length} steps`
    : `${steps.length} steps`;
  // One quiet line. While the bot works it names what it is doing now; when done it says how much work there was. The rail opens on click.
  const doing = live ?? (plan ? undefined : friendly(steps.at(-1)?.label)) ?? "Working";
  return (
    <details
      onToggle={measure}
      className="group/timeline w-full max-w-prose text-xs text-muted-foreground"
    >
      <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <CaretRightIcon
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform group-open/timeline:rotate-90 motion-reduce:transition-none"
        />
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-muted-foreground/50",
            working && "animate-pulse bg-primary motion-reduce:animate-none",
          )}
        />
        <span className="min-w-0 truncate">
          {working ? (
            <>
              {doing}
              {plan ? ` · ${count}` : ""}
            </>
          ) : (
            <>Worked · {count}</>
          )}
          {total !== undefined && (
            <>
              {" "}
              · <span className="tabular-nums">{elapsed(total)}</span>
            </>
          )}
        </span>
      </summary>
      <ol
        ref={list}
        aria-label={plan ? "Plan" : "Work timeline"}
        // A scrollable region needs a Tab stop, but only when it really scrolls (WCAG 2.1.1).
        tabIndex={overflows ? 0 : undefined}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
        }}
        // `relative` makes the list the containing block of the `sr-only` (absolute) step icons. Without it they escape the list's
        // overflow clip and stretch the chat log by the height of every step, a giant empty scroll while a task runs.
        className="relative mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-md border bg-muted/30 px-3 py-2 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {items.map((it, i) => (
          <li key={it.key} className="flex gap-2">
            <span className="flex flex-col items-center">
              <StepIcon state={it.state} />
              {i < items.length - 1 && <span aria-hidden="true" className="w-px grow bg-border" />}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 break-words pb-1.5",
                it.state === "running" && "text-foreground",
                it.state === "failed" && "text-destructive",
              )}
            >
              {it.stepId && working && stepOutputUrl ? (
                <StepToggle
                  label={it.label}
                  open={opened === it.stepId}
                  onToggle={() => setOpened((o) => (o === it.stepId ? undefined : it.stepId))}
                />
              ) : (
                it.label
              )}
              {it.detail && <span className="block text-muted-foreground">{it.detail}</span>}
              {it.stepId && working && stepOutputUrl && opened === it.stepId && (
                <StepOutput url={stepOutputUrl(it.stepId) ?? ""} label={it.label} />
              )}
            </span>
            {it.time && (
              <span className="shrink-0 tabular-nums text-muted-foreground/60">{it.time}</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
