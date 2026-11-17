import { ArrowCircleUpIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery } from "@tanstack/react-query";
import { UPDATE_COMMAND, type UpdateChange } from "@zetta/core/update-check";
import { toast } from "@/lib/notify";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Loading, Panel } from "../shared/ui";
import { updatesQueries, useIsAdmin, versionText, type VersionStatus } from "./updates-api";

const KIND_LABEL: Record<UpdateChange["type"], string> = {
  feat: "New",
  fix: "Fixed",
  perf: "Faster",
};

/** The changes of the check grouped by day, newest day first (they arrive sorted that way). */
function byDay(changes: readonly UpdateChange[]): { day: string; items: UpdateChange[] }[] {
  const days: { day: string; items: UpdateChange[] }[] = [];
  for (const c of changes) {
    const last = days[days.length - 1];
    if (last?.day === c.day) last.items.push(c);
    else days.push({ day: c.day, items: [c] });
  }
  return days;
}

function ChangeList({ changes }: { changes: readonly UpdateChange[] }) {
  return (
    <div className="space-y-4">
      {byDay(changes).map((d) => (
        <section key={d.day} aria-label={d.day} className="space-y-1.5">
          <h3 className="text-sm font-semibold tabular-nums">{d.day}</h3>
          <ul className="space-y-1">
            {d.items.map((c) => (
              <li key={`${c.sha}-${c.subject}`} className="text-sm text-pretty">
                <span className="font-medium">{KIND_LABEL[c.type]}</span>
                {c.scope ? <span className="text-muted-foreground"> ({c.scope})</span> : null}
                {": "}
                {c.subject}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The one command, in a box, with a button that copies it. */
function UpdateCommand() {
  async function copy() {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      toast.success("Command copied.");
    } catch {
      toast.error("Could not copy. Select the command and copy it by hand.");
    }
  }
  return (
    <Panel
      title="Update"
      description="Run this on the computer where Zetta is installed. It pulls the new code, keeps your settings and .env files, rebuilds and restarts Zetta."
    >
      <div className="flex flex-wrap items-center gap-2">
        <code
          aria-label="Update command"
          className="min-w-0 flex-1 basis-72 overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm whitespace-nowrap"
        >
          {UPDATE_COMMAND}
        </code>
        <Button type="button" variant="outline" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        Installed in another folder? Put <code className="font-mono">ZETTA_DIR=/path/to/zetta</code>{" "}
        before <code className="font-mono">bash</code>. Zetta is unavailable for a minute while it
        rebuilds; nothing you stored is touched.
      </p>
    </Panel>
  );
}

/** What the check found, in a sentence. */
function Verdict({ status }: { status: VersionStatus }) {
  if (status.state === "behind")
    return (
      <p role="status" className="text-sm text-pretty">
        A newer version is available. Changes were published up to{" "}
        <span className="tabular-nums">{status.latest?.date}</span>.
      </p>
    );
  if (status.state === "current")
    return (
      <p role="status" className="text-sm text-pretty">
        You are up to date. Nothing newer is published.
      </p>
    );
  return (
    <p role="status" className="text-sm text-pretty text-muted-foreground">
      {status.check === "off"
        ? "The update check is off, so Zetta does not look for new versions. Turn it on in Studio > Decisions."
        : !status.build
          ? "This build carries no version stamp (it was not built by the installer), so Zetta cannot tell whether a newer one exists."
          : "Zetta could not read the list of changes yet. It tries again by itself."}
    </p>
  );
}

/**
 * The Update page: what version this is, the changes published since, and the one command that updates it. For the administrator, who
 * runs the server; a member is told so. The Catch up card and the sidebar mark both lead here.
 */
export function UpdatePage() {
  const admin = useIsAdmin();
  const version = useQuery({ ...updatesQueries.version(), enabled: admin });
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <ArrowCircleUpIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">Update</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              {version.data ? versionText(version.data.build) : "Keep this installation current."}
            </p>
          </div>
        </header>
        {!admin ? (
          <p className="text-sm text-pretty text-muted-foreground">
            Only the administrator can update this installation.
          </p>
        ) : version.isError ? (
          <Alert theme="danger">
            {errorMessage(version.error, "Could not read the version of this server.")}
          </Alert>
        ) : !version.data ? (
          <Loading />
        ) : (
          <>
            <Verdict status={version.data} />
            {version.data.changes.length > 0 && (
              <Panel title="What changed since your version" count={version.data.changes.length}>
                <ChangeList changes={version.data.changes} />
              </Panel>
            )}
            <UpdateCommand />
          </>
        )}
      </div>
    </div>
  );
}
