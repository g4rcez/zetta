import { Link } from "@tanstack/react-router";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  HandIcon,
  LightbulbIcon,
  MoonIcon,
  WarningOctagonIcon,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@zetta/ui/lib/utils";

import { useBotStatus } from "../features/bots/status";
import type { BotStatus } from "../features/chat/chat-client";

/**
 * Green = online (idle or busy), amber = a person is needed (the only use of amber, see DESIGN.md "The Attention Rule"),
 * red = fatal, grey = offline. Color never carries the meaning alone: every status also has an icon and a label.
 */
export const BOT_STATUS: Record<
  BotStatus,
  { dot: string; text: string; Icon: Icon; label: string }
> = {
  available: { dot: "bg-success", text: "text-success", Icon: CheckCircleIcon, label: "Available" },
  working: {
    dot: "bg-success motion-safe:animate-pulse",
    text: "text-success",
    Icon: CircleNotchIcon,
    label: "Working",
  },
  planning: {
    dot: "bg-success motion-safe:animate-pulse",
    text: "text-success",
    Icon: LightbulbIcon,
    label: "Planning",
  },
  pending: { dot: "bg-warn", text: "text-warn", Icon: HandIcon, label: "Pending" },
  error: {
    dot: "bg-destructive",
    text: "text-destructive",
    Icon: WarningOctagonIcon,
    label: "Error",
  },
  offline: {
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    Icon: MoonIcon,
    label: "Offline",
  },
};

/** The corner dot for a `BotAvatar` badge. Nothing is drawn until the first status arrives. */
export function BotStatusDot({ botId, className }: { botId: string; className?: string }) {
  const entry = useBotStatus(botId);
  if (!entry) return null;
  const { dot, label } = BOT_STATUS[entry.status];
  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      title={`${label}: ${entry.reason}`}
      className={cn("size-2.5 rounded-full border-2 border-sidebar", dot, className)}
    />
  );
}

/** Icon + label for places with room (the chat header). The reason is the tooltip. */
export function BotStatusLabel({ botId, className }: { botId: string; className?: string }) {
  const entry = useBotStatus(botId);
  if (!entry) return null;
  const { text, Icon, label } = BOT_STATUS[entry.status];
  return (
    <span
      title={entry.reason}
      className={cn("label-mono inline-flex shrink-0 items-center gap-1", text, className)}
    >
      <Icon aria-hidden="true" className="size-3.5" weight="bold" />
      {label}
    </span>
  );
}

/**
 * The task the bot is on, as a link to it: its title and how many steps are done. Nothing is drawn for a bot without an open task.
 */
export function BotCurrentTask({ botId, className }: { botId: string; className?: string }) {
  const task = useBotStatus(botId)?.task;
  if (!task) return null;
  const steps = task.stepsTotal > 0 ? `${task.stepsDone}/${task.stepsTotal} steps` : undefined;
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: task.id }}
      title={steps ? `${task.title} (${steps})` : task.title}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="truncate">{task.title}</span>
      {steps && <span className="shrink-0 tabular-nums">{steps}</span>}
    </Link>
  );
}
