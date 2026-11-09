import { ActionHint } from "@/components/action-hint";
import {
  CellSignalHighIcon,
  CellSignalLowIcon,
  CellSignalMediumIcon,
  CellSignalNoneIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  EyeIcon,
  ProhibitIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Tag } from "@g4rcez/components/tag";
import { Badge } from "../shared/ui";
import { followUpView, type StepCount } from "./task-steps";
import { TASK_PRIORITIES, type Task, type TaskPriority, type TaskStatus } from "./tasks-api";

const STATUS_ICON = {
  backlog: { Icon: CircleDashedIcon, className: "text-muted-foreground" },
  in_progress: { Icon: CircleHalfIcon, className: "text-amber-500" },
  blocked: { Icon: ProhibitIcon, className: "text-red-500" },
  review: { Icon: EyeIcon, className: "text-emerald-500" },
  done: { Icon: CheckCircleIcon, className: "text-indigo-500" },
} as const;

export function StatusIcon({
  status,
  className = "size-4",
}: {
  status: TaskStatus;
  className?: string;
}) {
  const { Icon, className: color } = STATUS_ICON[status];
  return (
    <Icon
      weight={status === "done" ? "fill" : "bold"}
      aria-hidden
      className={`shrink-0 ${color} ${className}`}
    />
  );
}

// The color grows with the level: none is gray, then blue, amber, orange, and red for urgent.
const PRIORITY_ICON = {
  none: { Icon: CellSignalNoneIcon, className: "text-muted-foreground/50" },
  low: { Icon: CellSignalLowIcon, className: "text-sky-500" },
  medium: { Icon: CellSignalMediumIcon, className: "text-amber-500" },
  high: { Icon: CellSignalHighIcon, className: "text-orange-500" },
  urgent: { Icon: WarningIcon, className: "text-red-500" },
} as const;

export const priorityLabel = (priority: TaskPriority) =>
  TASK_PRIORITIES.find((p) => p.priority === priority)?.label ?? priority;

export function PriorityIcon({
  priority,
  className = "size-5",
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const { Icon, className: color } = PRIORITY_ICON[priority];
  return (
    <Icon
      weight={priority === "urgent" ? "fill" : "bold"}
      aria-label={priorityLabel(priority)}
      role="img"
      className={`shrink-0 ${color} ${className}`}
    />
  );
}

const INDICATORS = ["primary", "secondary", "info", "warn", "danger", "success"] as const;

/** The same label always gets the same dot color. */
export const labelIndicator = (label: string) =>
  INDICATORS[
    [...label].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 0) % INDICATORS.length
  ]!;

export function LabelChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <Tag theme="neutral" size="tiny" indicator={labelIndicator(label)} className="max-w-32">
      <span className="truncate">{label}</span>
      {onRemove && (
        <ActionHint label={`Remove label ${label}`}>
          <button
            type="button"
            aria-label={`Remove label ${label}`}
            onClick={onRemove}
            className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon aria-hidden className="size-3" />
          </button>
        </ActionHint>
      )}
    </Tag>
  );
}

/** The first labels as chips, and "+N" for the rest. */
export function LabelChips({ labels, max = 2 }: { labels: string[]; max?: number }) {
  return (
    <>
      {labels.slice(0, max).map((l) => (
        <LabelChip key={l} label={l} />
      ))}
      {labels.length > max && (
        <Tag theme="muted" size="tiny" title={labels.slice(max).join(", ")}>
          +{labels.length - max}
        </Tag>
      )}
    </>
  );
}

/** "3/5 steps": how far a task with a plan has come. The words are visible, so the chip needs no hint. */
export function StepChip({ count }: { count: StepCount }) {
  return (
    <span
      title={`${count.done} of ${count.total} steps done`}
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
    >
      {count.done}/{count.total} steps
    </span>
  );
}

/** "Following" while the server calls the bot back about this task, "Paused" when it stopped. Nothing when nobody follows it. */
export function FollowUpChip({
  task,
}: {
  task: Pick<Task, "followUp" | "followUpReason" | "status">;
}) {
  const view = followUpView(task);
  if (!view) return null;
  return (
    <span title={view.detail || undefined} className="shrink-0">
      <Badge tone={view.tone}>{view.label}</Badge>
    </span>
  );
}
