import { PROJECT_HEALTH_LABELS, type ProjectHealth } from "@zetta/core/projects";

import { BotAvatar } from "@/components/bot-avatar";
import { Progress } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import type { Bot } from "../chat/chat-client";
import { Badge } from "../shared/ui";
import type { Project, ProjectCounts } from "./projects-api";

const TONE = {
  needs_you: "warning",
  quiet: "neutral",
  on_track: "success",
  done: "info",
  on_hold: "neutral",
} as const;

/** Where a project stands, in one word. The sentence next to it says why. */
export function HealthBadge({ health }: { health: ProjectHealth }) {
  return <Badge tone={TONE[health.state]}>{PROJECT_HEALTH_LABELS[health.state]}</Badge>;
}

/** How much of the project is done, as a thin bar with the count beside it. Nothing while it has no tasks. */
export function ProjectProgress({ counts }: { counts: ProjectCounts }) {
  if (!counts.total) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <Progress
        className="w-24"
        value={counts.done}
        max={counts.total}
        label={`${counts.done} of ${counts.total} tasks done`}
        tone="success"
      />
      {counts.done}/{counts.total}
    </span>
  );
}

const FACES = 5;

/** Who is on a project: the first faces, bots then people, and how many more. The names are read out for someone who cannot see them. */
export function Faces({
  project,
  bots,
}: {
  project: Pick<Project, "bots" | "people">;
  bots: ReadonlyMap<string, Bot>;
}) {
  const all = [
    ...project.bots.map((b) => ({ key: `bot:${b.id}`, name: b.name, bot: bots.get(b.id) ?? b })),
    ...project.people.map((p) => ({ key: `person:${p.userId}`, name: p.name, bot: undefined })),
  ];
  if (!all.length) return <span className="text-xs text-muted-foreground">Nobody yet</span>;
  return (
    <span className="flex shrink-0 items-center">
      <span className="sr-only">{all.map((x) => x.name).join(", ")}</span>
      <span aria-hidden="true" className="flex -space-x-1.5">
        {all
          .slice(0, FACES)
          .map((x) =>
            x.bot ? (
              <BotAvatar key={x.key} bot={x.bot} size={24} className="ring-2 ring-card" />
            ) : (
              <UserAvatar key={x.key} name={x.name} size={24} className="ring-2 ring-card" />
            ),
          )}
      </span>
      {all.length > FACES && (
        <span aria-hidden="true" className="ml-1.5 text-xs text-muted-foreground">
          +{all.length - FACES}
        </span>
      )}
    </span>
  );
}
