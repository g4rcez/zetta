import { Link, useBlocker } from "@tanstack/react-router";
import { ChatCircleTextIcon, CheckIcon, CopyIcon, LinkIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";
import { ApiError, call } from "../chat/chat-client";
import { Response } from "../chat/response";
import { Badge, ConfirmButton, Empty, Loading, useList } from "../shared/ui";
import { AddLinkPanel } from "./add-link-panel";
import { AssistPanel } from "./assist-panel";
import { AskBox } from "./ask-box";
import { Fields, contentFields, metaFields } from "./item-fields";
import { LinkLists, SourceList, VersionList } from "./item-side";
import { MiniGraph } from "./mini-graph";
import { SharedItem } from "./shared-item";
import { useAction } from "./use-action";
import { appendLink } from "./wiki-links";
import { useWikiIndex } from "./use-wiki-index";
import {
  STATUS,
  TYPE,
  path,
  wikiError,
  type Author,
  type Bot,
  type Detail,
  type TeamName,
} from "./wiki-api";

/** The page of one item: what it says, when to use it, what it links to, where it came from, and its versions. */
export function WikiItemPage({
  slug,
  edit,
  assist,
}: {
  slug: string;
  edit: boolean;
  assist?: "links" | "tags" | "tidy" | undefined;
}) {
  const tf = useTimeFormat();
  const [detail, setDetail] = useState<Detail>();
  const [missing, setMissing] = useState<string>();
  const [editing, setEditing] = useState(edit);
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const h1 = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { items, wikiLinks, reload: reloadIndex } = useWikiIndex();
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);

  const load = useCallback(
    () =>
      call<Detail>(path(slug)).then(
        (d) => {
          setDetail(d);
          setMissing(undefined);
        },
        (e) => {
          setDetail(undefined);
          setMissing(e instanceof ApiError && e.status === 404 ? "" : wikiError(e));
        },
      ),
    [slug],
  );
  const { run, feedback, setError } = useAction(async () => {
    await load();
    void reloadIndex();
  });
  const [bots] = useList<Bot>("/api/bots", "bots", setError);
  const [teams] = useList<TeamName>("/api/teams", "teams", setError);
  useEffect(() => {
    setDetail(undefined);
    setMissing(undefined);
    setEditing(edit);
    void load();
  }, [load, edit]);
  // Leaving the page with unsaved edits asks first.
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm("Discard your changes?"),
    enableBeforeUnload: () => dirty,
    disabled: !dirty,
  });

  if (missing !== undefined && !detail)
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-8">
        <h1>{missing === "" ? "Item not found" : "The item could not load"}</h1>
        {missing === "" ? (
          <Empty>
            There is no item called “{slug}” that you can read.{" "}
            <Link to="/wiki" search={{ create: slug } as never} className="underline">
              Create it
            </Link>{" "}
            or{" "}
            <Link to="/wiki" className="underline">
              go back to the wiki
            </Link>
            .
          </Empty>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {missing}{" "}
            <Button size="xs" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </p>
        )}
      </div>
    );
  if (!detail)
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
        <Loading />
      </div>
    );
  if (detail.access === "shared")
    return (
      <div className="h-full overflow-y-auto">
        <SharedItem detail={detail} wikiLinks={wikiLinks} />
      </div>
    );

  const p = detail.page;
  const botName = (id: string | null) => bots?.find((b) => b.id === id)?.name ?? "a bot";
  const who = (by: Author, botId: string | null) =>
    by === "bot" ? botName(botId) : by === "system" ? "the source check" : "you";
  const when = (iso: string) => formatDateTime(iso, tf);
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await call(path(p.slug), "PUT", {
        ...contentFields(f),
        ...metaFields(f),
        expectedVersion: p.version,
      });
      setDirty(false);
      setEditing(false);
      requestAnimationFrame(() => h1.current?.focus());
    }, "Saved.");
  };
  const change = (body: object, done: string) => run(() => call(path(p.slug), "PATCH", body), done);
  const reach =
    p.type === "all"
      ? "Every member's bots can read this item. Only you can change it; others send suggestions."
      : p.type === "solo"
        ? `Only ${botName(p.authorBotId)} reads this item.`
        : p.type === "teams"
          ? `Bots in ${p.teams.map((id) => teams?.find((t) => t.id === id)?.name ?? "a team").join(", ")} read this item.`
          : "All your bots can read this item.";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/wiki" className="hover:underline">
            Wiki
          </Link>{" "}
          / {p.title}
        </nav>
        <header className="space-y-3">
          <h1 ref={h1} tabIndex={-1} className="text-balance outline-none">
            {p.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <Badge tone={p.type === "all" ? "info" : "neutral"}>{TYPE[p.type]}</Badge>
            {p.status !== "current" && (
              <Badge tone={p.status === "stale" ? "warning" : "neutral"}>{STATUS[p.status]}</Badge>
            )}
            <span className="tabular-nums text-muted-foreground">score {p.score} / 100</span>
            {p.tags.map((t) => (
              <Link key={t} to="/wiki" search={{ tag: t } as never} className="rounded-full">
                <Badge>{t}</Badge>
              </Link>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {reach} Version {p.version}, last saved by {who(p.updatedBy, p.updatedByBotId)} on{" "}
            {when(p.updatedAt)}.
          </p>
          {p.status !== "current" && (
            <p className="text-sm">
              {p.status === "stale"
                ? "This item may be out of date. Check it and save it to make it current."
                : "Bots do not see this item."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setAsking((a) => !a)}>
                <ChatCircleTextIcon aria-hidden="true" />
                Ask about this
              </Button>
            )}
            {!editing && items && (
              <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
                <LinkIcon aria-hidden="true" />
                Add link
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(`[[${p.slug}]]`).then(() => setCopied(true));
              }}
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              Copy [[{p.slug}]]
            </Button>
            {p.type !== "all" ? (
              <ConfirmButton
                label="Share with all members"
                question="Every member's bots will read this item. Share it?"
                confirmLabel="Share"
                onConfirm={() => change({ type: "all" }, "Shared with all members.")}
              />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void change({ type: "owner" }, "Only your bots can read it now.")}
              >
                Make private
              </Button>
            )}
            {p.status === "current" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void change({ status: "stale" }, "Marked stale.")}
              >
                Mark stale
              </Button>
            )}
            {p.status === "archived" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void change({ status: "current" }, "Restored from the archive.")}
              >
                Restore from archive
              </Button>
            ) : (
              <ConfirmButton
                label="Archive"
                question="Hide this item from your bots?"
                confirmLabel="Archive"
                onConfirm={() => change({ status: "archived" }, "Archived.")}
              />
            )}
          </div>
          <span aria-live="polite" className="sr-only">
            {copied ? "Copied" : ""}
          </span>
          {feedback}
        </header>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            {asking && !editing && (
              <AskBox
                autoFocus
                wikiLinks={wikiLinks}
                scope={{ ids: [p.id], label: `Only use “${p.title}”` }}
              />
            )}
            {adding && items && !editing && (
              <AddLinkPanel
                items={items}
                self={p.slug}
                linked={new Set(detail.links.map((l) => l.slug))}
                onClose={() => setAdding(false)}
                onAdd={(relation, slug) =>
                  run(async () => {
                    await call(path(p.slug), "PUT", {
                      title: p.title,
                      howto: p.howto,
                      tags: p.tags,
                      content: appendLink(p.content, relation, slug),
                      expectedVersion: p.version,
                    });
                    setAdding(false);
                  }, "Link added.")
                }
              />
            )}
            {editing ? (
              <form
                key={p.version}
                ref={form}
                onSubmit={save}
                onChange={() => setDirty(true)}
                className="space-y-2 rounded-xl border bg-card p-5"
              >
                <h2 className="text-sm font-medium">Edit</h2>
                <AssistPanel form={form} slug={p.slug} autoAsk={assist} />
                <Fields
                  page={p}
                  meta={p.type !== "all"}
                  bots={bots}
                  teams={teams}
                  items={items}
                  self={p.slug}
                />
                <div className="flex gap-2">
                  <Button size="sm" type="submit">
                    Save
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDirty(false);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                {p.howto && (
                  <section
                    aria-label="When to use"
                    className="rounded-lg border bg-muted/40 p-4 text-sm"
                  >
                    <h2 className="text-xs font-medium text-muted-foreground">When to use</h2>
                    <p className="mt-1">{p.howto}</p>
                  </section>
                )}
                <article className="rounded-xl border bg-card p-5">
                  <Response text={p.content} wikiLinks={wikiLinks} />
                </article>
              </>
            )}
          </div>
          <aside className="min-w-0 space-y-5">
            <LinkLists links={detail.links} linkedFrom={detail.linkedFrom} />
            {detail.links.length + detail.linkedFrom.length > 0 && (
              <MiniGraph slug={p.slug} title={p.title} />
            )}
            <SourceList sources={detail.sources} />
            <VersionList
              history={detail.history}
              current={p.version}
              who={who}
              when={when}
              onRestore={(version) =>
                void run(
                  () => call(`${path(p.slug)}/restore`, "POST", { version }),
                  `Version ${version} restored as a new version.`,
                )
              }
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
