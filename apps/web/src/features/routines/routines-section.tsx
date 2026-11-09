import { Link, useRouterState } from "@tanstack/react-router";
import {
  CaretRightIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockIcon,
  PauseIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { pollEvery } from "@/lib/query-policy";
import { useState } from "react";

import { cn } from "@zetta/ui/lib/utils";

import { useRoutineAttention, useRoutineUnreadChats } from "../attention/summary";
import { ActionHint } from "@/components/action-hint";
import { call } from "../chat/chat-client";

type Status =
  | "paused"
  | "scheduled"
  | "running"
  | "failed"
  | "interrupted"
  | "blocked"
  | "completed";
type Row = {
  id: string;
  title: string;
  paused: boolean;
  status?: Status;
  /** The routine's one chat (every run adds to it); null before the first run. */
  conversationId: string | null;
};

const OPEN_KEY = "zetta.sidebar-routines";
const ROW =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring";
const IDLE = "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground";
const mark = "size-3.5 shrink-0";
const statusOf = (r: Row): Status => r.status ?? (r.paused ? "paused" : "scheduled");
const NEEDS_YOU: Status[] = ["failed", "interrupted", "blocked"];

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

/** The routines of the user, refreshed while the sidebar is mounted: often while one runs, slowly otherwise. `undefined` until the first answer. */
function useRoutineRows() {
  const query = useQuery({
    queryKey: ["routines", { state: "active" }],
    queryFn: () => call<{ routines: Row[] }>("/api/routines?state=active").then((r) => r.routines),
    refetchInterval: (q) =>
      pollEvery(3000, 15_000, !!q.state.data?.some((r) => statusOf(r) === "running")),
  });
  return query.data ?? (query.isError ? [] : undefined);
}

const STATUS_LABEL: Record<Status, string> = {
  running: "Running",
  failed: "Last run failed",
  blocked: "Blocked",
  interrupted: "Interrupted",
  paused: "Paused",
  completed: "Completed",
  scheduled: "Scheduled",
};
const STATUS_ICON = {
  running: CircleNotchIcon,
  failed: WarningIcon,
  blocked: WarningIcon,
  interrupted: WarningIcon,
  paused: PauseIcon,
  completed: CheckIcon,
  scheduled: ClockIcon,
};

/**
 * The routine's current status as a mark. Each has a text name; colour never carries it alone. Amber is only for "a person is needed".
 * The row is a link, so the hint opens on mouse hover only; focus and a tap stay with the row, whose name has the mark's text.
 */
function StatusMark({ status, needsYou }: { status: Status; needsYou: boolean }) {
  // An open Inbox card outlives the run status (a recovery run resets it), so it keeps the warning, except while the run spins.
  const warn = needsYou && status !== "running" && !NEEDS_YOU.includes(status);
  const Icon = warn ? WarningIcon : STATUS_ICON[status];
  const label = warn ? "Needs you" : STATUS_LABEL[status];
  return (
    <ActionHint hoverOnly label={label}>
      <Icon
        role="img"
        aria-label={label}
        className={cn(
          mark,
          (warn || NEEDS_YOU.includes(status)) && "text-attention",
          status === "running" && "motion-safe:animate-spin",
        )}
      />
    </ActionHint>
  );
}

function RoutineRow({
  r,
  current,
  unread,
  needsYou,
}: {
  r: Row;
  current: boolean;
  unread: boolean;
  needsYou: boolean;
}) {
  const status = statusOf(r);
  const cls = cn(ROW, current ? "bg-sidebar-accent text-primary!" : IDLE);
  const body = (
    <>
      <StatusMark status={status} needsYou={needsYou} />
      <span className={cn("min-w-0 flex-1 truncate", (current || unread) && "font-medium")}>
        {r.title}
      </span>
      {unread && (
        <span
          role="img"
          aria-label="New run"
          className="size-2 shrink-0 rounded-full bg-muted-foreground"
        />
      )}
    </>
  );
  return (
    <li>
      {r.conversationId ? (
        <Link
          to="/chat/{-$chatId}"
          params={{ chatId: r.conversationId }}
          search={{}}
          data-chat-row
          aria-current={current ? "page" : undefined}
          title={r.title}
          className={cls}
        >
          {body}
        </Link>
      ) : (
        // No run yet, so no chat yet: the row opens the routine itself.
        <Link
          to="/routines"
          search={{ routine: r.id }}
          data-chat-row
          title={`${r.title} (no runs yet)`}
          className={cls}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

/** The shared sidebar's routine list: one row per routine, opening its one chat, marked with the routine's current status. */
export function RoutinesSection({ query }: { query: string }) {
  const rows = useRoutineRows();
  const unreadChats = useRoutineUnreadChats();
  const attention = useRoutineAttention();
  const [open, setOpen] = useState(readOpen);
  const chatId = useRouterState({
    select: (s) => /^\/chat\/([^/]+)$/.exec(s.location.pathname)?.[1],
  });
  const shown = (rows ?? []).filter((r) => r.title.toLowerCase().includes(query));
  const needsYou = (r: Row) => attention.has(r.id) || NEEDS_YOU.includes(statusOf(r));
  // Nothing to show: no routines yet, or a search that matches none.
  if (!shown.length) return null;
  // A search opens the section, so a match is never hidden.
  const expanded = query ? true : open;
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "closed" : "open");
      } catch {
        // Storage unavailable (private mode): the choice lasts for this session.
      }
      return !o;
    });
  return (
    <section aria-label="Routines">
      <div className="flex items-center gap-1 pt-3 pb-1 pl-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={toggle}
          className="label-mono flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <CaretRightIcon
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          <span className="truncate">Routines</span>
          <span className="tabular-nums">{shown.length}</span>
          {shown.some(needsYou) && (
            <WarningIcon
              role="img"
              aria-label="A routine needs you"
              className="size-3 shrink-0 text-attention"
            />
          )}
        </button>
      </div>
      {expanded && (
        <ul className="space-y-0.5">
          {shown.map((r) => (
            <RoutineRow
              key={r.id}
              r={r}
              current={!!r.conversationId && r.conversationId === chatId}
              unread={!!r.conversationId && unreadChats.has(r.conversationId)}
              needsYou={attention.has(r.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
