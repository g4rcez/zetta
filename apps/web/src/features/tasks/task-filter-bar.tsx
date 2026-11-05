import { Dropdown } from "@g4rcez/components/dropdown";
import { Menu, MenuItem } from "@g4rcez/components/menu";
import {
  CellSignalHighIcon,
  CheckIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TagIcon,
  UserCircleDashedIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { Button, Checkbox, Input } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zetta/ui/components/tooltip";
import type { Bot } from "../chat/chat-client";
import { LabelChip, PriorityIcon, StatusIcon } from "./task-badges";
import {
  activeCount,
  DEFAULT_STATE,
  FOR_ME,
  NO_BOT,
  SORT_OPTIONS,
  THREAD_OPTIONS,
  WINDOW_OPTIONS,
  type GroupBy,
  type TaskState,
} from "./task-filters";
import { TASK_COLUMNS, TASK_PRIORITIES } from "./tasks-api";

const toggle = <T,>(list: T[], item: T, on: boolean) =>
  on ? [...list, item] : list.filter((x) => x !== item);

/** Buttons that act as one choice. Used for the board/list and the group-by toggles. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5"
    >
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="sm"
          variant={o.value === value ? "secondary" : "ghost"}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * A chip that opens a panel of checkboxes. `Dropdown` renders its own `<button>`, so a `Button` as trigger would nest two
 * buttons: the chip gets the library's button classes instead. A chip with nothing chosen has a dashed border.
 */
function ChipPanel({
  icon,
  label,
  count,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Dropdown
      aria-label={`Filter by ${label.toLowerCase()}`}
      buttonProps={{
        className: `__button __button--size-small __button--rounded-default ${count > 0 ? "__button--theme-muted" : "__button--theme-neutral border-dashed"}`,
      }}
      trigger={
        <>
          {icon}
          {label}
          {count > 0 && (
            <span className="rounded bg-foreground/10 px-1.5 text-xs tabular-nums">{count}</span>
          )}
        </>
      }
    >
      <div className="flex min-w-48 flex-col gap-2">{children}</div>
    </Dropdown>
  );
}

function Option<T>({
  list,
  value,
  onChange,
  children,
}: {
  list: T[];
  value: T;
  onChange: (next: T[]) => void;
  children: ReactNode;
}) {
  return (
    <Checkbox
      size="small"
      checked={list.includes(value)}
      onChange={(e) => onChange(toggle(list, value, e.target.checked))}
    >
      <span className="inline-flex items-center gap-2">{children}</span>
    </Checkbox>
  );
}

/** A submenu of single choices. Picking one closes the menu. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Menu label={label} hover={false}>
      {options.map((o) => (
        <MenuItem
          key={o.value}
          title={o.label}
          Right={o.value === value ? CheckIcon : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
];

/** The avatar row filters by bot, by the tasks nobody owns, and by the tasks a bot asked of the viewer. */
function AssigneeRow({
  bots,
  selected,
  onChange,
}: {
  bots: Bot[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  /** The popover (hover or keyboard focus) names the avatar and says who it is; the avatar alone does not. */
  const avatar = (id: string, name: string, detail: string, face: ReactNode) => {
    const on = selected.includes(id);
    return (
      <Tooltip key={id}>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label={name}
              aria-pressed={on}
              onClick={() => onChange(toggle(selected, id, !on))}
              className={`!h-8 !w-8 !min-w-0 !p-0 ${on ? "ring-2 ring-foreground" : selected.length > 0 ? "opacity-50 hover:opacity-100" : ""}`}
            />
          }
        >
          {face}
        </TooltipTrigger>
        <TooltipContent className="flex-col items-start gap-0.5">
          <span className="font-medium">{name}</span>
          <span className="opacity-70">{detail}</span>
        </TooltipContent>
      </Tooltip>
    );
  };
  return (
    <div role="group" aria-label="Filter by assignee" className="flex flex-wrap items-center gap-1">
      {avatar(
        FOR_ME,
        "For me",
        "Tasks a bot asked of you",
        <UserCircleIcon aria-hidden className="size-6 text-foreground" />,
      )}
      {bots.map((b) =>
        avatar(
          b.id,
          b.name,
          b.description.trim() || (b.kind === "chief" ? "Chief" : "Specialist"),
          <BotAvatar bot={b} size={24} square />,
        ),
      )}
      {avatar(
        NO_BOT,
        "Unassigned",
        "Tasks nobody owns",
        <UserCircleDashedIcon aria-hidden className="size-6 text-muted-foreground" />,
      )}
    </div>
  );
}

export function TaskFilterBar({
  state,
  onChange,
  bots,
  labels,
}: {
  state: TaskState;
  onChange: (next: TaskState) => void;
  bots: Bot[];
  /** Every label in use, for the label panel. */
  labels: string[];
}) {
  const set = (patch: Partial<TaskState>) => onChange({ ...state, ...patch });
  const active = activeCount(state);
  const clear = () =>
    onChange({ ...DEFAULT_STATE, view: state.view, groupBy: state.groupBy, task: state.task });
  // Labels that were picked but no task uses any more still show, so they can be unpicked.
  const labelOptions = [...new Set([...labels, ...state.labels])].sort();

  return (
    <div role="search" aria-label="Filter tasks" className="flex flex-wrap items-center gap-2">
      <AssigneeRow bots={bots} selected={state.botIds} onChange={(botIds) => set({ botIds })} />
      <ChipPanel
        icon={<TagIcon aria-hidden className="size-4" />}
        label="Label"
        count={state.labels.length}
      >
        {labelOptions.length === 0 && (
          <p className="text-sm text-muted-foreground">No labels yet</p>
        )}
        {labelOptions.map((l) => (
          <Option key={l} list={state.labels} value={l} onChange={(next) => set({ labels: next })}>
            <LabelChip label={l} />
          </Option>
        ))}
      </ChipPanel>
      <ChipPanel
        icon={<CellSignalHighIcon aria-hidden className="size-4" />}
        label="Priority"
        count={state.priorities.length}
      >
        {TASK_PRIORITIES.map((p) => (
          <Option
            key={p.priority}
            list={state.priorities}
            value={p.priority}
            onChange={(next) => set({ priorities: next })}
          >
            <PriorityIcon priority={p.priority} />
            {p.label}
          </Option>
        ))}
      </ChipPanel>
      <ChipPanel
        icon={<StatusIcon status="in_progress" />}
        label="Status"
        count={state.statuses.length}
      >
        {TASK_COLUMNS.map((c) => (
          <Option
            key={c.status}
            list={state.statuses}
            value={c.status}
            onChange={(next) => set({ statuses: next })}
          >
            <StatusIcon status={c.status} />
            {c.label}
          </Option>
        ))}
      </ChipPanel>
      <Menu
        asChild
        hover={false}
        title="More filters"
        label={
          <Button type="button" size="sm" variant="outline">
            <FunnelIcon aria-hidden className="size-4" />
            Filter
          </Button>
        }
      >
        <Choice
          label="Thread"
          value={state.thread}
          options={THREAD_OPTIONS}
          onChange={(thread) => set({ thread })}
        />
        <Choice
          label="Updated"
          value={state.updated}
          options={WINDOW_OPTIONS}
          onChange={(updated) => set({ updated })}
        />
        <Choice
          label="Created"
          value={state.created}
          options={WINDOW_OPTIONS}
          onChange={(created) => set({ created })}
        />
        <Choice
          label="Sort"
          value={state.sort}
          options={SORT_OPTIONS}
          onChange={(sort) => set({ sort })}
        />
      </Menu>
      <Input
        hiddenLabel
        title="Search tasks"
        size="small"
        type="search"
        placeholder="Search title or description"
        value={state.query}
        maxLength={200}
        container="w-48 max-w-full"
        left={
          <MagnifyingGlassIcon aria-hidden="true" size={16} className="text-muted-foreground" />
        }
        onChange={(e) => set({ query: e.target.value })}
      />
      {(active > 0 || state.sort !== DEFAULT_STATE.sort) && (
        <Button type="button" size="sm" variant="ghost" aria-label="Clear filters" onClick={clear}>
          <XIcon /> Clear{active > 0 ? ` (${active})` : ""}
        </Button>
      )}
    </div>
  );
}
