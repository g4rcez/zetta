import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button, Checkbox } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";
import { learningApi, learningQueries, type Finding, type FindingKind } from "./learning-api";

const KIND_TEXT: Record<FindingKind, string> = {
  duplicate: "Says the same",
  check_pair: "May conflict",
  superseded_current: "Replaced",
  unused: "Not used",
  drop_kept: "Stopped helping",
};

function RefLink({ r, botId }: { r: Finding["refs"][number]; botId: string | null }) {
  if (r.kind === "memory" && r.slug)
    return (
      <Link to="/memory/$slug" params={{ slug: r.slug }} className="hover:underline">
        {r.label}
      </Link>
    );
  return botId ? (
    <Link
      to="/bots/$botId/settings"
      params={{ botId }}
      search={{ tab: "skills" }}
      className="hover:underline"
    >
      {r.label}
    </Link>
  ) : (
    <span>{r.label}</span>
  );
}

function FindingItem({
  finding,
  selected,
  busy,
  onSelect,
  onAccept,
  onDismiss,
}: {
  finding: Finding;
  selected: boolean;
  busy: boolean;
  onSelect: (on: boolean) => void;
  onAccept: (drop?: string) => void;
  onDismiss: () => void;
}) {
  const pair = finding.kind === "check_pair";
  return (
    <li className={listItem}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            {!pair && (
              <Checkbox
                aria-label={`Select: ${finding.summary}`}
                checked={selected}
                onChange={(e) => onSelect(e.target.checked)}
              />
            )}
            <p className="min-w-0 text-pretty">{finding.summary}</p>
          </div>
          <Badge tone={pair || finding.kind === "drop_kept" ? "warning" : "neutral"}>
            {KIND_TEXT[finding.kind]}
          </Badge>
        </div>
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {finding.refs.map((r) => (
            <li key={r.id}>
              {r.kind === "lesson" ? "Lesson" : "Memory"}: <RefLink r={r} botId={finding.botId} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {pair ? (
            finding.refs.map((r, i) => (
              <ConfirmButton
                key={r.id}
                label={i === 0 ? "Drop the first" : "Drop the second"}
                question={`Drop “${r.label}”? Nothing is deleted: you can bring it back.`}
                confirmLabel="Yes, drop it"
                variant="outline"
                onConfirm={() => onAccept(r.id)}
              />
            ))
          ) : (
            <ConfirmButton
              label="Accept"
              question="Do what it says? Nothing is deleted: you can bring archived items and lessons back."
              confirmLabel="Yes, do it"
              variant="outline"
              onConfirm={() => onAccept()}
            />
          )}
          <Button size="sm" type="button" variant="outline" disabled={busy} onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </li>
  );
}

/** What the weekly tidy-up noticed. Nothing changes until the person accepts it, and a dismissed suggestion does not come back. */
export function FindingsPanel() {
  const qc = useQueryClient();
  const { data, error: loadError } = useQuery(learningQueries.findings("open"));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const items = data ?? [];
  const pickable = items.filter((f) => f.kind !== "check_pair");
  // A selection only holds suggestions that are still open.
  const selected = pickable.filter((f) => selectedIds.includes(f.id));
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["learning"] });
      await qc.invalidateQueries({ queryKey: ["memory"] });
    }
  };
  return (
    <Panel
      title="Suggestions"
      count={items.length}
      description="Once a week, Zetta looks for lessons that repeat or pull against each other, items that were replaced, and items nobody uses. It only suggests: nothing changes until you accept."
    >
      {(error || loadError) && <Alert theme="danger">{error ?? errorMessage(loadError)}</Alert>}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
      {pickable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Checkbox
            aria-label="Select all"
            checked={selected.length > 0 && selected.length === pickable.length}
            onChange={(e) => setSelectedIds(e.target.checked ? pickable.map((f) => f.id) : [])}
          >
            {selected.length ? `${selected.length} selected` : "Select all"}
          </Checkbox>
          {selected.length > 0 && (
            <ConfirmButton
              label="Accept selected"
              question={`Accept ${selected.length} ${selected.length === 1 ? "suggestion" : "suggestions"}? Nothing is deleted: you can bring archived items and lessons back.`}
              confirmLabel="Yes, accept"
              variant="outline"
              onConfirm={() =>
                run(async () => {
                  for (const f of selected) await learningApi.acceptFinding(f.id);
                  setSelectedIds([]);
                }, `Done: ${selected.length}.`)
              }
            />
          )}
        </div>
      )}
      {data && items.length === 0 && <Empty>Nothing to tidy up. The next look is next week.</Empty>}
      <ul className={list}>
        {items.map((f) => (
          <FindingItem
            key={f.id}
            finding={f}
            selected={selectedIds.includes(f.id)}
            busy={busy}
            onSelect={(on) =>
              setSelectedIds(on ? [...selectedIds, f.id] : selectedIds.filter((id) => id !== f.id))
            }
            onAccept={(drop) => void run(() => learningApi.acceptFinding(f.id, drop), "Done.")}
            onDismiss={() => void run(() => learningApi.dismissFinding(f.id), "Dismissed.")}
          />
        ))}
      </ul>
    </Panel>
  );
}

/**
 * A weekly check of the lessons as one of the person's own workflows: it lists what the bots learned, asks the Chief which to drop and
 * waits for a yes. The workflow is made once; it can be opened and changed like any other.
 */
export function WeeklyCheck() {
  const [state, setState] = useState<{ busy: boolean; created?: boolean; error?: string }>({
    busy: false,
  });
  const add = async () => {
    setState({ busy: true });
    try {
      const r = await learningApi.addWeeklyCheck();
      setState({ busy: false, created: r.created });
    } catch (e) {
      setState({ busy: false, error: errorMessage(e) });
    }
  };
  return (
    <Panel
      title="Check these every week"
      description="Adds a workflow that lists your bots' lessons, asks your Chief which ones to drop, and waits for your yes before dropping anything. Nothing is deleted."
    >
      {state.error && <Alert theme="danger">{state.error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state.busy}
          onClick={() => void add()}
        >
          Add the weekly check to my workflows
        </Button>
        {state.created !== undefined && (
          <p role="status" className="text-sm">
            {state.created ? "Added." : "You already have it."}{" "}
            <Link to="/studio/$tab" params={{ tab: "workflows" }} className="underline">
              Open your workflows
            </Link>
          </p>
        )}
      </div>
    </Panel>
  );
}
