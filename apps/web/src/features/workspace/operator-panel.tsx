import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { toast } from "@/lib/notify";

import { errorMessage } from "../chat/chat-client";
import { formText } from "../shared/form-data";
import { Badge, ConfirmButton, Loading, Panel } from "../shared/ui";
import { workspaceApi, workspaceQueries, type OperatedWorkspace } from "./workspace-api";

/** A limit as typed: empty is no limit. */
const limitOf = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};
const used = (value: number, limit: number | null) =>
  limit === null
    ? `${value.toLocaleString()}`
    : `${value.toLocaleString()} of ${limit.toLocaleString()}`;

/** Runs or minutes of a workspace's month, against its limit, with a warning once the limit is reached. */
function Meter({ label, value, limit }: { label: string; value: number; limit: number | null }) {
  const over = limit !== null && value >= limit;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground">{label}: </span>
      {used(value, limit)}
      {over && <Badge tone="warning">Limit reached</Badge>}
    </span>
  );
}

type RowProps = { workspace: OperatedWorkspace };
/** One workspace: its numbers, its limits and what root does with it. */
function OperatedRow({ workspace: w }: RowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      toast.success(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const saveLimits = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const runsPerMonth = limitOf(formText(data, "runs"));
    const minutes = limitOf(formText(data, "minutes"));
    if (runsPerMonth === undefined || minutes === undefined)
      return setError("A limit is a whole number, or empty for no limit.");
    void act(
      () =>
        workspaceApi.setQuota(w.id, {
          runsPerMonth,
          runSecondsPerMonth: minutes === null ? null : minutes * 60,
        }),
      `Limits of ${w.name} saved.`,
    );
  };
  return (
    <li className="space-y-2 py-3" aria-label={w.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium">{w.name}</span>
          <span className="text-muted-foreground">{w.slug}</span>
          {w.own && <Badge>Yours</Badge>}
          {w.status !== "active" && (
            <Badge tone="warning">{w.status === "suspended" ? "Suspended" : "Being deleted"}</Badge>
          )}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => workspaceApi.download(w.id), "Copy downloaded.")}
          >
            Download a copy
          </Button>
          {!w.own && w.status !== "deleting" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    workspaceApi.setStatus(w.id, w.status === "active" ? "suspended" : "active"),
                  w.status === "active" ? `${w.name} is suspended.` : `${w.name} runs again.`,
                )
              }
            >
              {w.status === "active" ? "Suspend" : "Resume"}
            </Button>
          )}
          {!w.own && (
            <ConfirmButton
              label="Delete"
              size="xs"
              question={`Delete ${w.name} and everything in it? Its people lose it at once, and it cannot be undone. Download a copy first if anyone may need it.`}
              confirmLabel="Delete workspace"
              onConfirm={() => act(() => workspaceApi.remove(w.id), `${w.name} is deleted.`)}
            />
          )}
        </span>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="whitespace-nowrap">
          <span className="text-muted-foreground">People: </span>
          {w.people}
        </span>
        <Meter label="Runs this month" value={w.usage.runs} limit={w.quota.runsPerMonth} />
        <Meter
          label="Minutes this month"
          value={Math.ceil(w.usage.runSeconds / 60)}
          limit={
            w.quota.runSecondsPerMonth === null ? null : Math.round(w.quota.runSecondsPerMonth / 60)
          }
        />
      </p>
      <form onSubmit={saveLimits} className="flex flex-wrap items-end gap-2">
        <Input
          name="runs"
          title="Runs a month"
          inputMode="numeric"
          placeholder="No limit"
          defaultValue={w.quota.runsPerMonth ?? ""}
          className="w-32"
        />
        <Input
          name="minutes"
          title="Minutes a month"
          inputMode="numeric"
          placeholder="No limit"
          defaultValue={
            w.quota.runSecondsPerMonth === null ? "" : Math.round(w.quota.runSecondsPerMonth / 60)
          }
          className="w-32"
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          Save limits
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-pretty text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Root's view of every workspace on this server: names and numbers, never what is inside. Limits are what each may use a month; a run is
 * a bot answering or working once.
 */
export function OperatorPanel() {
  const { data, isError, error } = useQuery(workspaceQueries.operator());
  return (
    <Panel
      title="Workspaces"
      count={data?.length}
      description="Every workspace on this server, what it used this month and what it may use. Empty limits are no limit."
    >
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      ) : !data ? (
        <Loading />
      ) : (
        <ul className="divide-y" aria-label="Workspaces on this server">
          {data.map((w) => (
            <OperatedRow key={w.id} workspace={w} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The owner's copy of the workspace they work in. */
export function DownloadWorkspace() {
  const [busy, setBusy] = useState(false);
  return (
    <Panel
      title="A copy of this workspace"
      description="Everything this workspace holds, as one file. Secrets are not in it: only which connections there are."
    >
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void workspaceApi
            .download()
            .then(() => void toast.success("Copy downloaded."))
            .catch((e) => void toast.error(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Preparing…" : "Download a copy"}
      </Button>
    </Panel>
  );
}
