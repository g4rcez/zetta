import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { BotIdentity } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";
import { ago } from "../artifacts/artifacts-api";
import { ApiError, call } from "../chat/chat-client";
import { Badge, Empty, Loading } from "../shared/ui";
import { RailSection } from "./rail-section";
import { useAction } from "./use-action";
import { path, type Bot, type Brief, type Checks, type Problem } from "./wiki-api";
import { savedSlugs } from "./wiki-health";

const SHOWN = 6;
/** What a review job is called in "Background work". */
const JOB_LABEL: Record<Problem, string> = {
  all: "Fixing what needs work",
  brokenLinks: "Fixing links to missing items",
  unlinked: "Linking items that stand alone",
  old: "Checking items not saved for 90 days",
  stale: "Checking stale items",
  unsourced: "Adding sources",
};
const ACTIVE = ["pending", "running"];
const POLL_MS = 5000;

/** A group of items with the same problem; each row carries the one action that fixes it. */
function Group({
  title,
  hint,
  count,
  action,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <section aria-label={title} className="space-y-1.5 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm">
          {title} <Badge tone="warning">{count}</Badge>
        </h3>
        {action}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <ul className="space-y-3">{children}</ul>
      {count > SHOWN && <p className="text-xs text-muted-foreground">and {count - SHOWN} more</p>}
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => (
  <li className="space-y-1 text-sm">{children}</li>
);
const itemLink = (b: Brief) => (
  <Link
    to="/wiki/$slug"
    params={{ slug: b.slug }}
    className="line-clamp-2 break-words hover:underline"
  >
    {b.title}
  </Link>
);

const JOB_STATUS = {
  pending: { label: "Working", tone: "neutral" },
  running: { label: "Working", tone: "neutral" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Could not finish", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
} as const;

/** One background job: what it does, which bot did it, and where to read the chat of a review. */
function JobRow({ job: j, bots }: { job: Checks["jobs"][number]; bots: Bot[] | undefined }) {
  const tf = useTimeFormat();
  const status = JOB_STATUS[j.status as keyof typeof JOB_STATUS] ?? JOB_STATUS.skipped;
  const who =
    bots?.find((b) => b.id === j.botId) ??
    (j.botId ? { id: j.botId, name: j.botName ?? "A bot" } : undefined);
  const slugs = savedSlugs(j.result);
  const note = j.status === "done" && !slugs.length ? j.result : undefined;
  return (
    <li className="space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        {j.kind === "review"
          ? JOB_LABEL[j.problem]
          : j.source === "loop"
            ? "Learned from a finished goal"
            : "Learned from a finished task"}
      </p>
      {who ? (
        <BotIdentity
          bot={who}
          size={20}
          sub={
            <time dateTime={j.createdAt} title={formatDateTime(j.createdAt, tf)}>
              {ago(j.createdAt)}
            </time>
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">{ago(j.createdAt)}</p>
      )}
      {slugs.length > 0 && (
        <p className="text-xs break-words text-muted-foreground">
          Saved{" "}
          {slugs.map((s, i) => (
            <span key={s}>
              {i > 0 && ", "}
              <Link to="/wiki/$slug" params={{ slug: s }} className="hover:underline">
                {s}
              </Link>
            </span>
          ))}
        </p>
      )}
      {note && <p className="text-xs break-words text-muted-foreground">{note}</p>}
      {j.status === "failed" && (
        <p className="text-xs text-muted-foreground">It stopped before the end.</p>
      )}
      {j.conversationId && (
        <Link
          to="/chat/{-$chatId}"
          params={{ chatId: j.conversationId }}
          className="inline-block text-xs underline"
        >
          Open the chat
        </Link>
      )}
    </li>
  );
}

/** What needs work in the wiki, grouped by problem, with a button for each fix, and what the background jobs changed. */
export function HealthPanel({ bots }: { bots: Bot[] | undefined }) {
  const [data, setData] = useState<Checks>();
  const [failed, setFailed] = useState(false);
  const load = useCallback(
    () =>
      call<Checks>("/api/wiki-checks").then(
        (d) => {
          setData(d);
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [],
  );
  const { run, feedback } = useAction(load);
  useEffect(() => {
    void load();
  }, [load]);
  // While the chief works the panel follows: the groups shrink as items are fixed, and the job ends here.
  const busy = data?.jobs.some((j) => j.kind === "review" && ACTIVE.includes(j.status)) ?? false;
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [busy, load]);
  if (failed && !data)
    return (
      <RailSection title="Needs work" label="Wiki health">
        <p role="alert" className="text-sm text-destructive">
          The checks could not load.{" "}
          <Button size="xs" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </p>
      </RailSection>
    );
  if (!data)
    return (
      <RailSection title="Needs work" label="Wiki health">
        <Loading />
      </RailSection>
    );
  const c = data.checks;
  const total =
    c.brokenLinks.length + c.stale.length + c.old.length + c.unlinked.length + c.unsourced.length;
  const chief = bots?.find((b) => b.kind === "chief");
  const working = (p: Problem) =>
    data.jobs.some((j) => j.kind === "review" && j.problem === p && ACTIVE.includes(j.status));
  const ask = (problem: Problem) =>
    run(
      async () => {
        try {
          await call("/api/wiki-review", "POST", { problem });
        } catch (e) {
          throw e instanceof ApiError && e.status === 404
            ? new Error("A review needs a chief bot.")
            : e;
        }
      },
      `${chief?.name ?? "Your chief"} is working on it. Follow it in Background work.`,
    );
  /** The button of a group: the chief's avatar and name, so it is clear who does the work. */
  const fix = (problem: Problem, label: string) => (
    <Button
      size="xs"
      variant="outline"
      disabled={working(problem)}
      onClick={() => void ask(problem)}
      className="shrink-0"
    >
      {chief && <BotAvatar bot={chief} size={16} />}
      {working(problem) ? "Working…" : label}
    </Button>
  );
  const fixLabel = `Ask ${chief?.name ?? "the chief"} to fix`;
  const setStatus = (slug: string, status: string, done: string) =>
    run(() => call(path(slug), "PATCH", { status }), done);
  const small = "shrink-0";
  return (
    <RailSection
      title="Needs work"
      label="Wiki health"
      count={total}
      description="Items your bots or the checks flagged. Fix one here, or ask your chief to fix a whole group."
      action={total > 0 ? fix("all", `${fixLabel} all`) : undefined}
    >
      {total === 0 && <Empty>Nothing to fix.</Empty>}
      <Group
        title="Links to missing items"
        action={fix("brokenLinks", fixLabel)}
        hint="A [[link]] points to an item that does not exist."
        count={c.brokenLinks.length}
      >
        {c.brokenLinks.slice(0, SHOWN).map((l) => (
          <Row key={`${l.slug}:${l.target}`}>
            <span className="line-clamp-2 break-words">
              <Link to="/wiki/$slug" params={{ slug: l.slug }} className="hover:underline">
                {l.slug}
              </Link>{" "}
              → [[{l.target}]]
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link
                to="/wiki"
                search={{ create: l.target } as never}
                className={`${small} text-xs underline`}
              >
                Create it
              </Link>
              <Link
                to="/wiki/$slug"
                params={{ slug: l.slug }}
                search={{ edit: "1", assist: "links" } as never}
                className={`${small} text-xs underline`}
              >
                Fix the link
              </Link>
            </span>
          </Row>
        ))}
      </Group>
      <Group
        title="Marked stale"
        action={fix("stale", fixLabel)}
        hint="Its source changed, or someone doubted it."
        count={c.stale.length}
      >
        {c.stale.slice(0, SHOWN).map((b) => (
          <Row key={b.slug}>
            {itemLink(b)}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                size="xs"
                variant="outline"
                onClick={() => void setStatus(b.slug, "current", "Marked current.")}
              >
                Still true
              </Button>
              <Link
                to="/wiki/$slug"
                params={{ slug: b.slug }}
                search={{ edit: "1", assist: "tidy" } as never}
                className={`${small} text-xs underline`}
              >
                Tidy with help
              </Link>
            </span>
          </Row>
        ))}
      </Group>
      <Group
        title="Not saved for 90 days"
        action={fix("old", fixLabel)}
        hint="Still marked current. Check it is true, or mark it stale."
        count={c.old.length}
      >
        {c.old.slice(0, SHOWN).map((b) => (
          <Row key={b.slug}>
            {itemLink(b)}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                size="xs"
                variant="outline"
                onClick={() => void setStatus(b.slug, "stale", "Marked stale.")}
              >
                Mark stale
              </Button>
              <Link
                to="/wiki/$slug"
                params={{ slug: b.slug }}
                search={{ edit: "1", assist: "tidy" } as never}
                className={`${small} text-xs underline`}
              >
                Review
              </Link>
            </span>
          </Row>
        ))}
      </Group>
      <Group
        title="Not linked to anything"
        action={fix("unlinked", fixLabel)}
        hint="Nothing links to it and it links to nothing, so a graph search cannot reach it."
        count={c.unlinked.length}
      >
        {c.unlinked.slice(0, SHOWN).map((b) => (
          <Row key={b.slug}>
            {itemLink(b)}
            <Link
              to="/wiki/$slug"
              params={{ slug: b.slug }}
              search={{ edit: "1", assist: "links" } as never}
              className={`${small} text-xs underline`}
            >
              Suggest links
            </Link>
          </Row>
        ))}
      </Group>
      <Group
        title="Without sources"
        action={fix("unsourced", fixLabel)}
        hint="No task, document or artifact backs it, so it is never marked stale by itself."
        count={c.unsourced.length}
      >
        {c.unsourced.slice(0, SHOWN).map((b) => (
          <Row key={b.slug}>{itemLink(b)}</Row>
        ))}
      </Group>
      {data.jobs.length > 0 && (
        <section aria-label="Background work" className="space-y-1.5 border-t pt-3">
          <h3 className="text-sm">Background work</h3>
          <ul className="space-y-3">
            {data.jobs.map((j) => (
              <JobRow key={j.id} job={j} bots={bots} />
            ))}
          </ul>
        </section>
      )}
      {c.openSuggestions > 0 && (
        <p className="text-sm text-muted-foreground">
          {c.openSuggestions} open{" "}
          {c.openSuggestions === 1 ? "suggestion waits" : "suggestions wait"} for you above.
        </p>
      )}
      {feedback}
    </RailSection>
  );
}
