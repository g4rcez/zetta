import { Link, useRouterState } from "@tanstack/react-router";
import {
  CaretRightIcon,
  CircleNotchIcon,
  HashIcon,
  LifebuoyIcon,
  ListBulletsIcon,
  LockKeyIcon,
  PauseIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@zetta/ui/lib/utils";

import { useRooms } from "../chat/sidebar-data";
import { TeamRoomRows } from "../teams/team-chats";
import type { DiscussionListItem } from "./discussions-api";
import { groupRooms, roomLabel, roomSignal, type RoomSignal } from "./rooms";
import { saveLocal } from "@/lib/local-storage";

const OPEN_KEY = "zetta.sidebar-sections";
type Sections = { rooms: boolean; issues: boolean };

/** Rooms start open and bot issues start closed; the user's choice is a per-browser preference. */
function readSections(): Sections {
  const fallback: Sections = { rooms: true, issues: false };
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    return {
      rooms: typeof raw?.rooms === "boolean" ? raw.rooms : fallback.rooms,
      issues: typeof raw?.issues === "boolean" ? raw.issues : fallback.issues,
    };
  } catch {
    return fallback;
  }
}

const ROW =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring";
const IDLE = "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground";

/** The mark on the right of a row. Each one has a text name for screen readers; colour never carries it alone. */
function Signal({ signal }: { signal: RoomSignal }) {
  if (signal === "needs-you")
    return (
      <span
        role="img"
        aria-label="Needs you"
        className="size-2 shrink-0 rounded-full bg-attention"
      />
    );
  if (signal === "working")
    return (
      <CircleNotchIcon
        role="img"
        aria-label="A bot is working"
        className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
      />
    );
  if (signal === "paused")
    return (
      <PauseIcon
        role="img"
        aria-label="Paused"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  return null;
}

function Head({
  title,
  count,
  open,
  onToggle,
  action,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 pt-3 pb-1 pl-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="label-mono flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CaretRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="truncate">{title}</span>
        {count ? <span className="tabular-nums">{count}</span> : null}
      </button>
      {action}
    </div>
  );
}

function RoomRow({
  d,
  current,
  icon,
  label,
}: {
  d: DiscussionListItem;
  current: boolean;
  icon: ReactNode;
  label: string;
}) {
  const signal = roomSignal(d);
  return (
    <li>
      <Link
        to="/rooms"
        search={{ id: d.id }}
        data-chat-row
        aria-current={current ? "page" : undefined}
        title={label}
        className={cn(ROW, current ? "bg-sidebar-accent text-primary!" : IDLE)}
      >
        {icon}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            (current || signal === "needs-you") && "font-medium",
          )}
        >
          {label}
        </span>
        <Signal signal={signal} />
      </Link>
    </li>
  );
}

const icon = "size-4 shrink-0 text-muted-foreground";

/**
 * The shared sidebar's room lists, Slack style: the user's rooms as `#` rows, and the Chief's help and permission rooms (made to
 * solve a bot's issue) kept apart under "Bot issues", closed by default.
 */
export function RoomsSection({ query }: { query: string }) {
  const { rooms } = useRooms();
  const [sections, setSections] = useState(readSections);
  const selected = useRouterState({
    select: (s) =>
      s.location.pathname === "/rooms" ? (s.location.search as { id?: string }).id : undefined,
  });
  const onList = useRouterState({
    select: (s) => s.location.pathname === "/rooms" && !(s.location.search as { id?: string }).id,
  });
  const { rooms: live, issues } = useMemo(() => groupRooms(rooms ?? []), [rooms]);
  const matches = (d: DiscussionListItem) => roomLabel(d).toLowerCase().includes(query);
  const shownRooms = live.filter(matches);
  const shownIssues = issues.filter(matches);
  const teamsWithRoom = useMemo(() => new Set(live.map((d) => d.teamId)), [live]);
  const toggle = (key: keyof Sections) =>
    setSections((s) => {
      const next = { ...s, [key]: !s[key] };
      saveLocal(OPEN_KEY, next);
      return next;
    });
  // A search opens everything, so a match is never hidden inside a closed section.
  const roomsOpen = query ? true : sections.rooms;
  const issuesOpen = query ? true : sections.issues;
  const waiting = issues.filter((d) => roomSignal(d) === "needs-you").length;
  return (
    <>
      <section aria-label="Rooms">
        <Head
          title="Rooms"
          open={roomsOpen}
          onToggle={() => toggle("rooms")}
          action={
            <Link
              to="/rooms"
              search={{ new: true }}
              aria-label="New room"
              title="New room"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <PlusIcon aria-hidden="true" className="size-4" />
            </Link>
          }
        />
        {roomsOpen && (
          <ul className="space-y-0.5">
            {shownRooms.map((d) => (
              <RoomRow
                key={d.id}
                d={d}
                current={d.id === selected}
                icon={<HashIcon aria-hidden="true" className={icon} />}
                label={d.title}
              />
            ))}
            <TeamRoomRows hasRoom={(id) => teamsWithRoom.has(id)} query={query} rowClass={ROW} />
            {rooms && !query && live.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                No rooms yet. Start one with +.
              </li>
            )}
            <li>
              <Link
                to="/rooms"
                search={{}}
                aria-current={onList ? "page" : undefined}
                className={cn(ROW, onList ? "bg-sidebar-accent font-medium text-primary!" : IDLE)}
              >
                <ListBulletsIcon aria-hidden="true" className={icon} />
                <span className="min-w-0 flex-1 truncate">All rooms</span>
              </Link>
            </li>
          </ul>
        )}
      </section>
      {issues.length > 0 && (!query || shownIssues.length > 0) && (
        <section aria-label="Bot issues">
          <Head
            title="Bot issues"
            count={issues.length}
            open={issuesOpen}
            onToggle={() => toggle("issues")}
          />
          {waiting > 0 && !issuesOpen && (
            <p className="px-2 pb-1 text-xs text-muted-foreground">{waiting} need you</p>
          )}
          {issuesOpen && (
            <ul className="space-y-0.5">
              {shownIssues.map((d) => (
                <RoomRow
                  key={d.id}
                  d={d}
                  current={d.id === selected}
                  icon={
                    d.kind === "help" ? (
                      <LifebuoyIcon aria-hidden="true" className={icon} />
                    ) : (
                      <LockKeyIcon aria-hidden="true" className={icon} />
                    )
                  }
                  label={roomLabel(d)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
