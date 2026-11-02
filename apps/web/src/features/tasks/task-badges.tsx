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
import { TASK_PRIORITIES, type TaskPriority, type TaskStatus } from "./tasks-api";

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
        <button
          type="button"
          aria-label={`Remove label ${label}`}
          onClick={onRemove}
          className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <XIcon aria-hidden className="size-3" />
        </button>
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
