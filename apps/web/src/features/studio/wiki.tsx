import { useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui";

import { ApiError, call, errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, Panel, useList } from "../shared/ui";

type Status = "current" | "stale" | "archived";
type Scope = "private" | "installation";
type Row = {
  slug: string;
  title: string;
  type: string;
  summary: string;
  status: Status;
  scope: Scope;
  version: number;
  updatedBy: "user" | "bot" | "system";
  updatedAt: string;
};
type SharedRow = {
  slug: string;
  title: string;
  type: string;
  summary: string;
  status: Status;
  ownerName: string;
  updatedAt: string;
};
type Page = Row & { body: string; updatedByBotId: string | null };
type Source = {
  kind: "task" | "doc" | "artifact" | "url";
  ref: string;
  label: string;
  status: "current" | "changed" | "gone";
  checkedAt: string;
};
type Detail =
  | {
      access: "own";
      page: Page;
      linkedFrom: { slug: string; title: string }[];
      history: {
        version: number;
        title: string;
        status: Status;
        author: "user" | "bot" | "system";
        botId: string | null;
        createdAt: string;
      }[];
      sources: Source[];
    }
  | {
      access: "shared";
      ownerName: string;
      page: Page;
      linkedFrom: { slug: string; title: string }[];
    };
type Suggestions = {
  incoming: {
    id: string;
    slug: string;
    pageTitle: string;
    currentBody: string;
    pageVersion: number;
    title: string;
    body: string;
    reason: string;
    baseVersion: number;
    authorName: string;
    createdAt: string;
  }[];
  outgoing: {
    id: string;
    slug: string;
    pageTitle: string;
    status: string;
    reason: string;
    createdAt: string;
  }[];
};
type Brief = { slug: string; title: string };
type Checks = {
  checks: {
    brokenLinks: { slug: string; target: string }[];
    unlinked: Brief[];
    old: Brief[];
    stale: Brief[];
    unsourced: Brief[];
    openSuggestions: number;
  };
  jobs: {
    id: string;
    kind: "learn" | "review";
    source: string;
    status: string;
    result: string;
    botName: string | null;
    createdAt: string;
  }[];
};
const TYPE = {
  entity: "Thing or person",
  system: "System",
  decision: "Decision",
  howto: "How to",
  gotcha: "Known problem",
  reference: "Reference",
  note: "Note",
} as const;
const SOURCE = { task: "Task", doc: "Document", artifact: "Artifact", url: "Web page" } as const;
const date = (iso: string) => new Date(iso).toLocaleString();
const path = (slug: string) => `/api/wiki/${encodeURIComponent(slug)}`;

function wikiError(e: unknown) {
  if (e instanceof ApiError && e.code === "CONFLICT")
    return "This page changed somewhere else. It was reloaded; make your change again.";
  return errorMessage(e);
}

/** Runs one action and shows its result or its error next to the form. */
function useAction(after: () => Promise<unknown> | void) {
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(undefined);
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      setError(wikiError(e));
    }
    await after();
  };
  const feedback = (
    <>
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
  return { run, feedback, setError };
}

function Fields({ page }: { page?: Pick<Page, "title" | "type" | "summary" | "body"> }) {
  return (
    <>
      <Input
        title="Title"
        name="title"
        required
        maxLength={160}
        defaultValue={page?.title}
        placeholder="e.g. Acme billing"
      />
      <Select
        title="Kind of page"
        name="type"
        required={false}
        defaultValue={page?.type ?? "note"}
        options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))}
      />
      <Input
        title="Summary (one line, shown in search)"
        name="summary"
        maxLength={300}
        defaultValue={page?.summary}
      />
      <Textarea
        title="Page (Markdown; link other pages as [[slug]])"
        name="body"
        required
        rows={10}
        maxLength={20000}
        defaultValue={page?.body}
      />
    </>
  );
}
const fields = (f: FormData) => ({
  title: String(f.get("title")).trim(),
  type: String(f.get("type") || "note"),
  summary: String(f.get("summary") ?? "").trim(),
  body: String(f.get("body")).trim(),
});

function SharedPage({
  detail,
  onClose,
}: {
  detail: Extract<Detail, { access: "shared" }>;
  onClose: () => void;
}) {
  const { run, feedback } = useAction(() => undefined);
  const p = detail.page;
  return (
    <Panel
      title={p.title}
      label={`Shared wiki page ${p.title}`}
      description={
        <>
          Shared by {detail.ownerName} · [[{p.slug}]] · version {p.version}. Read only: suggest a
          change and {detail.ownerName} decides.
        </>
      }
      action={
        <Button size="sm" variant="outline" onClick={onClose}>
          Back to all pages
        </Button>
      }
    >
      {p.status === "stale" && (
        <p className="text-sm">
          <Badge tone="warning">Marked stale</Badge> This page may be out of date.
        </p>
      )}
      <p className="whitespace-pre-wrap break-words text-sm">{p.body}</p>
      <form
        className="space-y-2 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(
            () =>
              call(`${path(p.slug)}/suggestions`, "POST", {
                ...fields(f),
                reason: String(f.get("reason") ?? "").trim(),
              }),
            `Sent to ${detail.ownerName}.`,
          );
        }}
      >
        <h3 className="text-sm font-medium">Suggest a change</h3>
        <Fields page={p} />
        <Input title="Why (optional)" name="reason" maxLength={500} />
        <Button size="sm" type="submit">
          Send suggestion
        </Button>
      </form>
      {feedback}
    </Panel>
  );
}

function PageEditor({
  slug,
  bots,
  onClose,
  onChanged,
}: {
  slug: string;
  bots: { id: string; name: string }[] | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail>();
  const load = useCallback(
    () => call<Detail>(path(slug)).then(setDetail, (e) => setError(wikiError(e))),
    [slug],
  );
  const { run, feedback, setError } = useAction(async () => {
    await load();
    onChanged();
  });
  useEffect(() => {
    void load();
  }, [load]);
  const botName = (id: string | null) => bots?.find((b) => b.id === id)?.name ?? "a bot";
  if (!detail) return feedback;
  if (detail.access === "shared") return <SharedPage detail={detail} onClose={onClose} />;
  const p = detail.page;
  const who = (by: "user" | "bot" | "system", botId: string | null) =>
    by === "bot" ? botName(botId) : by === "system" ? "the source check" : "you";
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(
      () => call(path(p.slug), "PUT", { ...fields(f), expectedVersion: p.version }),
      "Saved.",
    );
  };
  const change = (body: object, done: string) => run(() => call(path(p.slug), "PATCH", body), done);
  return (
    <Panel
      title={p.title}
      label={`Wiki page ${p.title}`}
      description={
        <>
          [[{p.slug}]] · version {p.version} · last saved by {who(p.updatedBy, p.updatedByBotId)} on{" "}
          {date(p.updatedAt)}
        </>
      }
      action={
        <Button size="sm" variant="outline" onClick={onClose}>
          Back to all pages
        </Button>
      }
    >
      {p.status !== "current" && (
        <p className="text-sm">
          <Badge tone={p.status === "stale" ? "warning" : "neutral"}>
            {p.status === "stale" ? "Marked stale" : "Archived"}
          </Badge>{" "}
          {p.status === "stale"
            ? "This page may be out of date. Check it and save it to make it current."
            : "Bots do not see this page."}
        </p>
      )}
      <p className="text-sm">
        {p.scope === "installation" ? (
          <>
            <Badge tone="info">Shared</Badge> Every member's bots can read this page. Only you can
            change it; others send suggestions.
          </>
        ) : (
          "Only your bots can read this page."
        )}
      </p>
      <form key={p.version} onSubmit={save} className="space-y-2">
        <Fields page={p} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit">
            Save
          </Button>
          {p.scope === "private" ? (
            <ConfirmButton
              label="Share with all members"
              question="Every member's bots will read this page. Share it?"
              confirmLabel="Share"
              onConfirm={() => change({ scope: "installation" }, "Shared with all members.")}
            />
          ) : (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void change({ scope: "private" }, "Only your bots can read it now.")}
            >
              Make private
            </Button>
          )}
          {p.status === "current" && (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void change({ status: "stale" }, "Marked stale.")}
            >
              Mark stale
            </Button>
          )}
          {p.status === "archived" ? (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void change({ status: "current" }, "Restored from the archive.")}
            >
              Restore from archive
            </Button>
          ) : (
            <ConfirmButton
              label="Archive"
              question="Hide this page from your bots?"
              confirmLabel="Archive"
              onConfirm={() => change({ status: "archived" }, "Archived.")}
            />
          )}
        </div>
      </form>
      {feedback}
      {detail.linkedFrom.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Linked from: {detail.linkedFrom.map((l) => l.title).join(", ")}
        </p>
      )}
      <section aria-label="Sources" className="space-y-2">
        <h3 className="text-sm font-medium">Sources</h3>
        {detail.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sources. A bot links the task, document or artifact a page came from; when one
            changes, the page is marked stale.
          </p>
        ) : (
          <ul className={list}>
            {detail.sources.map((s) => (
              <li
                key={`${s.kind}:${s.ref}`}
                className={`${listItem} flex flex-wrap items-center gap-2`}
              >
                <Badge>{SOURCE[s.kind]}</Badge>
                {s.kind === "url" ? (
                  <a
                    href={s.ref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all hover:underline"
                  >
                    {s.label}
                  </a>
                ) : (
                  <span className="break-words">{s.label}</span>
                )}
                {s.status !== "current" && (
                  <Badge tone="warning">{s.status === "gone" ? "Gone" : "Changed"}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Versions" className="space-y-2">
        <h3 className="text-sm font-medium">Versions</h3>
        <ul className={list}>
          {detail.history.map((h) => (
            <li
              key={h.version}
              className={`${listItem} flex flex-wrap items-center justify-between gap-2`}
            >
              <span>
                Version {h.version} · {who(h.author, h.botId)} · {date(h.createdAt)}
                {h.status !== "current" && (
                  <span className="ml-2">
                    <Badge>{h.status}</Badge>
                  </span>
                )}
              </span>
              {h.version !== p.version && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void run(
                      () => call(`${path(p.slug)}/restore`, "POST", { version: h.version }),
                      `Version ${h.version} restored as a new version.`,
                    )
                  }
                >
                  Restore<span className="sr-only"> version {h.version}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

function SuggestionsPanel({ onOpen }: { onOpen: (slug: string) => void }) {
  const [data, setData] = useState<Suggestions>();
  const load = useCallback(
    () => call<Suggestions>("/api/wiki-suggestions").then(setData, () => undefined),
    [],
  );
  const { run, feedback } = useAction(load);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || (!data.incoming.length && !data.outgoing.length)) return null;
  return (
    <Panel
      title="Suggestions"
      label="Wiki suggestions"
      count={data.incoming.length}
      description="Changes other members suggested for pages you shared, and the ones you sent."
    >
      {data.incoming.length > 0 && (
        <ul className={list} aria-label="Suggestions for your pages">
          {data.incoming.map((s) => (
            <li key={s.id} className={`${listItem} space-y-2`}>
              <p>
                <span className="font-medium">{s.authorName}</span> suggests a change to{" "}
                <button
                  type="button"
                  className="font-medium hover:underline"
                  onClick={() => onOpen(s.slug)}
                >
                  {s.pageTitle}
                </button>
                {s.baseVersion !== s.pageVersion && (
                  <span className="ml-2">
                    <Badge tone="warning">Written for an older version</Badge>
                  </span>
                )}
              </p>
              {s.reason && <p className="text-muted-foreground">Why: {s.reason}</p>}
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Now</p>
                  <p className="whitespace-pre-wrap break-words">{s.currentBody}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Suggested</p>
                  <p className="whitespace-pre-wrap break-words">{s.body}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  onClick={() =>
                    void run(
                      () =>
                        call(`/api/wiki-suggestions/${s.id}/decision`, "POST", {
                          decision: "accept",
                        }),
                      "Accepted: the page has a new version.",
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void run(
                      () =>
                        call(`/api/wiki-suggestions/${s.id}/decision`, "POST", {
                          decision: "reject",
                        }),
                      "Rejected.",
                    )
                  }
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.outgoing.length > 0 && (
        <ul className={list} aria-label="Your suggestions">
          {data.outgoing.map((s) => (
            <li
              key={s.id}
              className={`${listItem} flex flex-wrap items-center justify-between gap-2`}
            >
              <span>
                Your suggestion for {s.pageTitle} ·{" "}
                <Badge
                  tone={
                    s.status === "accepted" ? "success" : s.status === "open" ? "info" : "neutral"
                  }
                >
                  {s.status}
                </Badge>
              </span>
              {s.status === "open" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void run(() => call(`/api/wiki-suggestions/${s.id}`, "DELETE"), "Withdrawn.")
                  }
                >
                  Withdraw
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {feedback}
    </Panel>
  );
}

function ChecksPanel({ onOpen }: { onOpen: (slug: string) => void }) {
  const [data, setData] = useState<Checks>();
  const load = useCallback(
    () => call<Checks>("/api/wiki-checks").then(setData, () => undefined),
    [],
  );
  const { run, feedback } = useAction(load);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;
  const c = data.checks;
  const pages = (label: string, xs: Brief[]) =>
    xs.length > 0 && (
      <li className={listItem}>
        {label}:{" "}
        {xs.slice(0, 20).map((x, i) => (
          <span key={x.slug}>
            {i > 0 && ", "}
            <button type="button" className="hover:underline" onClick={() => onOpen(x.slug)}>
              {x.title}
            </button>
          </span>
        ))}
        {xs.length > 20 && ` and ${xs.length - 20} more`}
      </li>
    );
  const review = () =>
    run(async () => {
      try {
        await call("/api/wiki-review", "POST");
      } catch (e) {
        throw e instanceof ApiError && e.status === 404
          ? new Error("A review needs a chief bot.")
          : e;
      }
    }, "Your chief will review the wiki in the next minute and tell you what it changed.");
  return (
    <Panel
      title="Checks"
      label="Wiki checks"
      description="Pages that may need work. Your chief can fix contradictions, merge duplicates and repair links."
      action={
        <Button size="sm" variant="outline" onClick={() => void review()}>
          Ask the chief to review
        </Button>
      }
    >
      <ul className={list}>
        {c.brokenLinks.length > 0 && (
          <li className={listItem}>
            Links to missing pages:{" "}
            {c.brokenLinks
              .slice(0, 20)
              .map((l) => `${l.slug} → [[${l.target}]]`)
              .join(", ")}
          </li>
        )}
        {pages("Marked stale", c.stale)}
        {pages("Not saved for 90 days", c.old)}
        {pages("Without sources", c.unsourced)}
        {pages("Not linked to or from other pages", c.unlinked)}
      </ul>
      {!c.brokenLinks.length &&
        !c.stale.length &&
        !c.old.length &&
        !c.unsourced.length &&
        !c.unlinked.length && <Empty>Nothing to fix.</Empty>}
      {data.jobs.length > 0 && (
        <section aria-label="Background wiki work" className="space-y-2">
          <h3 className="text-sm font-medium">Background work</h3>
          <ul className={list}>
            {data.jobs.map((j) => (
              <li key={j.id} className={`${listItem} flex flex-wrap items-center gap-2`}>
                <Badge
                  tone={
                    j.status === "done" ? "success" : j.status === "failed" ? "danger" : "neutral"
                  }
                >
                  {j.status}
                </Badge>
                <span>
                  {j.kind === "review"
                    ? "Review"
                    : j.source === "loop"
                      ? "Learned from a finished goal"
                      : "Learned from a finished task"}{" "}
                  · {j.botName ?? "a bot"} · {date(j.createdAt)}
                </span>
                {j.result && <span className="break-words text-muted-foreground">{j.result}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {feedback}
    </Panel>
  );
}

/** The user's wiki: what their bots learned, one topic per page, plus pages other members shared. Every save keeps a version. */
export function Wiki({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<{ pages: Row[]; shared: SharedRow[] }>();
  const reload = useCallback(
    () =>
      call<{ pages: Row[]; shared: SharedRow[] }>("/api/wiki").then(setData, (e) =>
        onError(errorMessage(e)),
      ),
    [onError],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const [bots] = useList<{ id: string; name: string }>("/api/bots", "bots", onError);
  const search = useSearch({ from: "/_auth/studio/$tab" }) as { page?: unknown };
  const [open, setOpen] = useState<string | undefined>(
    typeof search.page === "string" ? search.page : undefined,
  );
  const [filter, setFilter] = useState("");
  const { run, feedback } = useAction(reload);
  if (open)
    return (
      <PageEditor
        slug={open}
        bots={bots}
        onClose={() => setOpen(undefined)}
        onChanged={() => void reload()}
      />
    );
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const v = fields(new FormData(form));
    // The server makes the slug from the title ("Acme billing" -> acme-billing); version 0 refuses to overwrite a page with that name.
    void run(async () => {
      try {
        await call(path(v.title), "PUT", { ...v, expectedVersion: 0 });
        form.reset();
      } catch (err) {
        if (err instanceof ApiError && err.code === "CONFLICT")
          throw new Error("A page with this name exists. Open it from the list to change it.");
        throw err;
      }
    }, "Saved.");
  };
  const q = filter.trim().toLowerCase();
  const match = (r: { title: string; summary: string; slug: string }) =>
    !q || `${r.title} ${r.summary} ${r.slug}`.toLowerCase().includes(q);
  const meta = (r: Row) =>
    `[[${r.slug}]] · saved by ${r.updatedBy === "bot" ? "a bot" : r.updatedBy === "system" ? "the source check" : "you"} on ${date(r.updatedAt)}`;
  return (
    <div className="space-y-6">
      <Panel
        title="Your wiki"
        label="Wiki"
        count={data?.pages.length}
        description="What your bots learned while working: clients, systems, decisions and known problems. All your bots search it before they start work, and they add to it when they finish a task. Never save passwords or keys here."
      >
        <Input
          title="Find a page"
          hiddenLabel
          name="filter"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          placeholder="Find a page…"
        />
        {data?.pages.length === 0 && (
          <Empty>
            No pages yet. Your bots add pages when they learn something, or you can write one below.
          </Empty>
        )}
        <ul className={list}>
          {data?.pages.filter(match).map((r) => (
            <li key={r.slug} className={listItem}>
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => setOpen(r.slug)}
              >
                {r.title}
              </button>
              <span className="ml-2 inline-flex gap-1 align-middle">
                <Badge>{TYPE[r.type as keyof typeof TYPE] ?? r.type}</Badge>
                {r.scope === "installation" && <Badge tone="info">Shared</Badge>}
                {r.status === "stale" && <Badge tone="warning">Stale</Badge>}
                {r.status === "archived" && <Badge>Archived</Badge>}
              </span>
              {r.summary && <p className="break-words text-muted-foreground">{r.summary}</p>}
              <p className="text-xs text-muted-foreground">{meta(r)}</p>
            </li>
          ))}
        </ul>
      </Panel>
      {(data?.shared.length ?? 0) > 0 && (
        <Panel
          title="Shared by other members"
          label="Shared wiki pages"
          count={data?.shared.length}
          description="Your bots read these pages too. To change one, open it and suggest a change."
        >
          <ul className={list}>
            {data?.shared.filter(match).map((r) => (
              <li key={r.slug} className={listItem}>
                <button
                  type="button"
                  className="font-medium hover:underline"
                  onClick={() => setOpen(r.slug)}
                >
                  {r.title}
                </button>
                <span className="ml-2 inline-flex gap-1 align-middle">
                  <Badge>{TYPE[r.type as keyof typeof TYPE] ?? r.type}</Badge>
                  {r.status === "stale" && <Badge tone="warning">Stale</Badge>}
                </span>
                {r.summary && <p className="break-words text-muted-foreground">{r.summary}</p>}
                <p className="text-xs text-muted-foreground">
                  Shared by {r.ownerName} · {date(r.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <SuggestionsPanel onOpen={setOpen} />
      <ChecksPanel onOpen={setOpen} />
      <Panel title="Write a page" label="New wiki page">
        <form onSubmit={add} className="space-y-2">
          <Fields />
          <Button size="sm" type="submit">
            Save page
          </Button>
        </form>
        {feedback}
      </Panel>
    </div>
  );
}
