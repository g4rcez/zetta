import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Select } from "@/components/ui";
import { formatSize } from "../artifacts/artifacts-api";
import { errorMessage, type Bot } from "../chat/chat-client";
import { Badge } from "../shared/ui";
import { skillsApi, skillsQueries, type SkillOverviewRow } from "./skills-api";

const SOURCE: Record<SkillOverviewRow["source"], { label: string; tone: "neutral" | "info" }> = {
  library: { label: "From your library", tone: "info" },
  bot: { label: "Written for this bot", tone: "neutral" },
  builtin: { label: "Built in", tone: "neutral" },
  host: { label: "From the server", tone: "neutral" },
};

/**
 * Every skill one bot has, from every place, with its size, what hides what, and (Hermes) how much of its prompt budget they use.
 * A library skill can be taken away or added here; the others are edited where they live (the section above, or the server).
 */
export function BotSkills({ bot }: { bot: Bot }) {
  const qc = useQueryClient();
  const overview = useQuery(skillsQueries.overview(bot.id));
  const library = useQuery(skillsQueries.list("mine"));
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string>();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["skills", "overview", bot.id] }),
      qc.invalidateQueries({ queryKey: ["skills", "list"] }),
    ]);
  const act = async (work: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  if (overview.isPending) return <p className="text-xs text-muted-foreground">Loading skills...</p>;
  if (overview.error || !overview.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(overview.error)}
      </p>
    );
  const { budget, skills } = overview.data;
  const attached = new Set(skills.filter((s) => s.skillId).map((s) => s.skillId));
  const available = (library.data ?? []).filter((s) => !attached.has(s.id));
  const pct = budget ? Math.min(100, Math.round((budget.used / budget.limit) * 100)) : 0;
  return (
    <section aria-label="All skills" className="space-y-3">
      <h4 className="font-medium">All the skills {bot.name} has</h4>
      {budget && (
        <div className="space-y-1">
          <div
            role="meter"
            aria-label="Skills size budget"
            aria-valuemin={0}
            aria-valuemax={budget.limit}
            aria-valuenow={budget.used}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full ${budget.dropped ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatSize(budget.used)} of {formatSize(budget.limit)} that Hermes puts in its prompt.
            {budget.dropped > 0 &&
              ` ${budget.dropped} ${budget.dropped === 1 ? "skill is" : "skills are"} left out because they do not fit.`}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {skills.length === 0 ? (
        <p className="text-xs text-muted-foreground">This bot has no skills yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {skills.map((s) => (
            <li
              key={`${s.source}:${s.name}`}
              className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge tone={SOURCE[s.source].tone}>{SOURCE[s.source].label}</Badge>
                  {s.bytes !== null && (
                    <span className="text-xs text-muted-foreground">{formatSize(s.bytes)}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
                {s.hiddenBy && (
                  <p className="text-xs text-warn">
                    Not used: a skill of the same name written for this bot is used instead.
                  </p>
                )}
                {s.unusable && (
                  <p className="text-xs text-destructive">
                    Not used: its text no longer passes the checks. Open it and save it again.
                  </p>
                )}
                {s.fits === false && !s.hiddenBy && !s.unusable && (
                  <p className="text-xs text-destructive">
                    Left out of the prompt: the skills before it use the whole budget.
                  </p>
                )}
              </div>
              {s.skillId && (
                <div className="flex items-center gap-2">
                  <Link to="/skills" search={{ find: s.name }} className="text-xs underline">
                    Open
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() =>
                      void act(() =>
                        skillsApi.bulk({
                          action: "detach",
                          skillIds: [s.skillId!],
                          botIds: [bot.id],
                        }),
                      )
                    }
                  >
                    Take away
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding) return;
            void act(async () => {
              const r = await skillsApi.bulk({
                action: "attach",
                skillIds: [adding],
                botIds: [bot.id],
              });
              if (r.skippedBots.length)
                throw new Error("This bot already has the most skills a bot can bring.");
              setAdding("");
            });
          }}
        >
          <div className="min-w-0 flex-1">
            <Select
              title="Add a skill from your library"
              required={false}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              options={[
                { value: "", label: "Choose a skill" },
                ...available.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <Button size="sm" type="submit" disabled={!adding}>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}
