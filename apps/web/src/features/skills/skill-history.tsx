import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui";
import { formatSize } from "../artifacts/artifacts-api";
import { errorMessage } from "../chat/chat-client";
import { relativeTime } from "../shared/relative-time";
import { Badge } from "../shared/ui";
import { diffStats, lineDiff } from "./diff";
import { skillsApi, skillsQueries } from "./skills-api";

/**
 * The saves of one skill, newest first. Pick one to see what it changed compared with the skill now, and put it back if it was better:
 * going back is a new save, so nothing in the history is ever lost.
 */
export function SkillHistory({
  skillId,
  onChanged,
}: {
  skillId: string;
  /** Called after a save was put back, so the list refreshes. */
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const history = useQuery(skillsQueries.history(skillId));
  const current = useQuery({
    queryKey: ["skills", "get", skillId, history.data?.currentVersion],
    queryFn: () => skillsApi.get(skillId),
    enabled: Boolean(history.data),
  });
  const [open, setOpen] = useState<string>();
  const chosen = useQuery({
    queryKey: ["skills", "revision", skillId, open],
    queryFn: () => skillsApi.revision(skillId, open!),
    enabled: Boolean(open),
  });
  const [error, setError] = useState<string>();
  if (history.isPending) return <p className="text-xs text-muted-foreground">Loading history...</p>;
  if (history.error || !history.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(history.error)}
      </p>
    );
  const { revisions, currentVersion } = history.data;
  const lines =
    chosen.data && current.data ? lineDiff(chosen.data.body, current.data.body) : undefined;
  const stats = lines ? diffStats(lines) : undefined;
  return (
    <section aria-label="History" className="space-y-2 rounded-md border p-3 text-sm">
      <ul className="divide-y">
        {revisions.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span>{relativeTime(r.createdAt)}</span>
                {i === 0 && <Badge tone="success">Now</Badge>}
                <span className="text-xs text-muted-foreground">
                  by {r.savedBy} · {formatSize(r.bodyBytes)}
                </span>
              </p>
            </div>
            {i > 0 && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                aria-pressed={open === r.id}
                onClick={() => setOpen(open === r.id ? undefined : r.id)}
              >
                {open === r.id ? "Hide changes" : "See changes"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {open && chosen.data && lines && stats && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            From that save to now: {stats.added} {stats.added === 1 ? "line" : "lines"} added,{" "}
            {stats.removed} removed.
            {chosen.data.description !== current.data?.description &&
              " The description changed too."}
          </p>
          <pre
            aria-label="Changes"
            className="max-h-72 overflow-auto rounded bg-muted/50 p-2 text-xs"
          >
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  l.kind === "add"
                    ? "bg-success/15"
                    : l.kind === "del"
                      ? "bg-destructive/15 line-through decoration-destructive/40"
                      : ""
                }
              >
                <span aria-hidden="true" className="select-none">
                  {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
                </span>
                {l.text || " "}
              </div>
            ))}
          </pre>
          <Button
            size="sm"
            type="button"
            onClick={() =>
              void skillsApi
                .revert(skillId, chosen.data!.id, currentVersion)
                .then(async () => {
                  setError(undefined);
                  setOpen(undefined);
                  await qc.invalidateQueries({ queryKey: ["skills"] });
                  onChanged();
                })
                .catch((e) => setError(errorMessage(e)))
            }
          >
            Put this version back
          </Button>
        </div>
      )}
    </section>
  );
}
