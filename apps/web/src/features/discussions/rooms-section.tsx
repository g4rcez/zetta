import { ActionHint } from "@/components/action-hint";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretRightIcon,
  CircleNotchIcon,
  DotsThreeIcon,
  HashIcon,
  HourglassIcon,
  LifebuoyIcon,
  ListBulletsIcon,
  LockKeyIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@zetta/ui/lib/utils";

import { MENU_DANGER, Menu, MenuItem, MenuSeparator, Modal } from "@/components/ui";
import { saveLocal } from "@/lib/local-storage";
import { toast } from "@/lib/notify";
import { refreshAttention } from "../attention/summary";
import { moveInGroup, placeGroup } from "../chat/bot-order";
import { errorMessage } from "../chat/chat-client";
import { useRooms } from "../chat/sidebar-data";
import { usePreferences } from "../preferences/preferences";
import { TeamRoomRows } from "../teams/team-chats";
import { discussionsApi, type DiscussionListItem } from "./discussions-api";
import { groupRooms, orderRooms, roomLabel, roomSignal, type RoomSignal } from "./rooms";
import { shownProgress } from "./room-progress";

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
  if (signal === "queued")
    return (
      <HourglassIcon
        role="img"
        aria-label="Waiting for a turn"
        className="size-3.5 shrink-0 text-muted-foreground"
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

/** What the row menu does to a room. */
type RoomAction = "pause" | "resume" | "cancel" | "delete";

type Reordering = {
  ids: string[];
  dragging: RefObject<boolean>;
  /** Moves this room one place up (-1) or down (+1) inside the list. */
  onMove: (delta: -1 | 1) => void;
};

/** A room row: opens the room, and its menu pauses, cancels or deletes it. With `reordering` it also drags and moves like a bot row. */
function RoomRow({
  d,
  current,
  icon,
  label,
  reordering,
  onAction,
}: {
  d: DiscussionListItem;
  current: boolean;
  icon: ReactNode;
  label: string;
  reordering?: Reordering | undefined;
  onAction: (d: DiscussionListItem, action: RoomAction) => void;
}) {
  const signal = roomSignal(d);
  // A room the lead reported on shows a thin line at the foot of its row; the page has the full bar and the note.
  const progress = d.status === "open" || d.status === "paused" ? shownProgress(d) : null;
  const controls = useDragControls();
  const reduce = useReducedMotion();
  const at = reordering ? reordering.ids.indexOf(d.id) : -1;
  const body = (
    <div
      className="group/room relative"
      onPointerDown={reordering ? (e) => controls.start(e) : undefined}
      onKeyDown={(e) => {
        if (!reordering || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        reordering.onMove(e.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <Link
        to="/rooms"
        search={{ id: d.id }}
        data-chat-row
        aria-current={current ? "page" : undefined}
        title={progress === null ? label : `${label} · ${progress}%`}
        onClick={(e) => {
          // A drag that ends over the row is not a click.
          if (reordering?.dragging.current) e.preventDefault();
        }}
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
        <span className="flex shrink-0 items-center group-focus-within/room:opacity-0 group-hover/room:opacity-0">
          <Signal signal={signal} />
        </span>
      </Link>
      {progress !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full bg-border/60"
        >
          <span className="block h-full bg-primary/70" style={{ width: `${progress}%` }} />
        </span>
      )}
      <Menu
        asChild
        hover={false}
        title=""
        floatingClassName="w-48"
        label={
          <ActionHint label={`Actions for ${label}`}>
            <button
              type="button"
              aria-label={`Actions for ${label}`}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/room:opacity-100 data-open:opacity-100"
            >
              <DotsThreeIcon aria-hidden="true" className="size-4" />
            </button>
          </ActionHint>
        }
      >
        {reordering && (
          <>
            <MenuItem title="Move up" disabled={at <= 0} onClick={() => reordering.onMove(-1)}>
              <ArrowUpIcon />
              Move up
            </MenuItem>
            <MenuItem
              title="Move down"
              disabled={at < 0 || at >= reordering.ids.length - 1}
              onClick={() => reordering.onMove(1)}
            >
              <ArrowDownIcon />
              Move down
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {d.status === "open" ? (
          <MenuItem title="Pause room" onClick={() => onAction(d, "pause")}>
            <PauseIcon />
            Pause room
          </MenuItem>
        ) : (
          <MenuItem title="Resume room" onClick={() => onAction(d, "resume")}>
            <PlayIcon />
            Resume room
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem title="Cancel room" className={MENU_DANGER} onClick={() => onAction(d, "cancel")}>
          <XCircleIcon />
          Cancel room
        </MenuItem>
        <MenuItem title="Delete room" className={MENU_DANGER} onClick={() => onAction(d, "delete")}>
          <TrashIcon />
          Delete room
        </MenuItem>
      </Menu>
    </div>
  );
  if (!reordering) return <li>{body}</li>;
  return (
    <Reorder.Item
      as="li"
      value={d.id}
      dragListener={false}
      dragControls={controls}
      // "position" only: the default layout animation also scales the box and its text.
      layout="position"
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 40 }}
      tabIndex={-1}
      whileDrag={{ boxShadow: "0 4px 12px rgb(0 0 0 / 0.24)", zIndex: 1 }}
      onDragStart={() => {
        reordering.dragging.current = true;
      }}
      onDragEnd={() => {
        setTimeout(() => {
          reordering.dragging.current = false;
        }, 0);
      }}
      className="cursor-grab rounded-md bg-sidebar active:cursor-grabbing"
    >
      {body}
    </Reorder.Item>
  );
}

const CONFIRM: Record<"cancel" | "delete", { title: string; description: string; text: string }> = {
  cancel: {
    title: "Cancel this room?",
    description: "Queued bot turns are dropped.",
    text: "Cancel room",
  },
  delete: {
    title: "Delete this room?",
    description: "It stops and leaves your lists. Its history is kept.",
    text: "Delete room",
  },
};

/** The sidebar menu's actions on a room. Cancel and delete ask first, as in the room's own menu; the open room is left when it goes. */
function useRoomActions(selected: string | undefined, reload: () => Promise<void>) {
  const navigate = useNavigate();
  return useCallback(
    async (d: DiscussionListItem, action: RoomAction) => {
      try {
        if (action === "cancel" || action === "delete") {
          const ok = await Modal.confirm<boolean>({
            title: CONFIRM[action].title,
            description: CONFIRM[action].description,
            confirm: { text: CONFIRM[action].text, theme: "danger" },
          });
          if (!ok) return;
        }
        if (action === "delete") {
          await discussionsApi.remove(d.id);
          toast.success("Room deleted.");
        } else await discussionsApi.act(d.id, action);
        await reload();
        void refreshAttention();
        if (d.id === selected && (action === "cancel" || action === "delete"))
          void navigate({ to: "/rooms", search: {} });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [navigate, reload, selected],
  );
}

const icon = "size-4 shrink-0 text-muted-foreground";

/**
 * The shared sidebar's room lists, Slack style: the user's rooms as `#` rows, and the Chief's help and permission rooms (made to
 * solve a bot's issue) kept apart under "Bot issues", closed by default.
 */
export function RoomsSection({ query }: { query: string }) {
  const { rooms, reload } = useRooms();
  const { preferences, set: setPreferences } = usePreferences();
  const dragging = useRef(false);
  const [announcement, setAnnouncement] = useState("");
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
  const ordered = useMemo(
    () => orderRooms(live, preferences.roomOrder),
    [live, preferences.roomOrder],
  );
  const shownRooms = ordered.filter(matches);
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
  const onAction = useRoomActions(selected, reload);
  const ids = ordered.map((d) => d.id);
  const saveGroup = (next: string[]) =>
    setPreferences({ roomOrder: placeGroup(preferences.roomOrder, next) });
  const move = (id: string, delta: -1 | 1) => {
    const moved = moveInGroup(ids, id, delta);
    if (!moved) return;
    saveGroup(moved.group);
    const title = ordered.find((d) => d.id === id)?.title ?? "Room";
    setAnnouncement(`${title} moved to position ${moved.position} of ${ids.length}`);
  };
  // A search lists a part of the rooms, so dragging would place the wrong neighbours: it waits for the full list, like the bots.
  const canReorder = !query && ids.length > 1;
  const waiting = issues.filter((d) => roomSignal(d) === "needs-you").length;
  return (
    <>
      <section aria-label="Rooms">
        <Head
          title="Rooms"
          open={roomsOpen}
          onToggle={() => toggle("rooms")}
          action={
            <ActionHint label="New room">
              <Link
                to="/rooms"
                search={{ new: true }}
                aria-label="New room"
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PlusIcon aria-hidden="true" className="size-4" />
              </Link>
            </ActionHint>
          }
        />
        {roomsOpen && (
          <>
            {canReorder ? (
              <Reorder.Group
                axis="y"
                as="ul"
                values={ids}
                onReorder={saveGroup}
                className="space-y-0.5"
              >
                {shownRooms.map((d) => (
                  <RoomRow
                    key={d.id}
                    d={d}
                    current={d.id === selected}
                    icon={<HashIcon aria-hidden="true" className={icon} />}
                    label={d.title}
                    reordering={{ ids, dragging, onMove: (delta) => move(d.id, delta) }}
                    onAction={onAction}
                  />
                ))}
              </Reorder.Group>
            ) : (
              <ul className="space-y-0.5">
                {shownRooms.map((d) => (
                  <RoomRow
                    key={d.id}
                    d={d}
                    current={d.id === selected}
                    icon={<HashIcon aria-hidden="true" className={icon} />}
                    label={d.title}
                    onAction={onAction}
                  />
                ))}
              </ul>
            )}
            <ul className="space-y-0.5">
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
          </>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
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
                  onAction={onAction}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
