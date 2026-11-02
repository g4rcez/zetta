import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { call } from "../chat/chat-client";
import { Response } from "../chat/response";
import { Badge, Empty, Loading } from "../shared/ui";
import { decodeDraft, type WikiDraft } from "./draft";
import { useWikiIndex } from "./use-wiki-index";
import { path, wikiError, type Detail } from "./wiki-api";

const Shell = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="h-full overflow-y-auto">
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 md:p-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to="/wiki" className="hover:underline">
          Wiki
        </Link>{" "}
        / {title}
      </nav>
      {children}
    </div>
  </div>
);

const Draft = ({ note, children }: { note: ReactNode; children?: ReactNode }) => (
  <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
    <Badge tone="warning">Draft</Badge>
    {note} Not saved: this page lives only in the link. Approve the suggestion in the chat to apply
    it.
    {children}
  </p>
);

/** What the change would do to an item that exists, shown on the item as it is now (patch: as it would be after). */
const NOTE: Record<"link" | "confirm" | "sources" | "archive" | "mark_stale", string> = {
  link: "Would add a link to another item.",
  confirm: "Would confirm the item is still right.",
  sources: "Would add sources to the item.",
  archive: "Would archive the item and hide it from your bots.",
  mark_stale: "Would mark the item as stale.",
};

function Change({ draft }: { draft: Exclude<WikiDraft, { action: "write" }> }) {
  const { wikiLinks } = useWikiIndex();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call<Detail>(path(draft.slug)).then(setDetail, (e) => setError(wikiError(e)));
  }, [draft.slug]);
  if (error)
    return (
      <Shell title={draft.slug}>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </Shell>
    );
  if (!detail)
    return (
      <Shell title={draft.slug}>
        <Loading />
      </Shell>
    );
  const p = detail.page;
  const hits = draft.action === "patch" ? p.content.split(draft.match).length - 1 : 0;
  const content =
    draft.action === "patch" && draft.match && hits === 1
      ? p.content.replace(draft.match, () => draft.content)
      : p.content;
  return (
    <Shell title={p.title}>
      <header className="space-y-2">
        <h1 className="text-balance">{p.title}</h1>
        {draft.action === "patch" ? (
          <Draft
            note={
              hits === 1
                ? "The item as it would be after the change."
                : "The change would fail: the text to replace is not in the item exactly once."
            }
          />
        ) : (
          <Draft note={NOTE[draft.action]}>
            {draft.action === "link" && (
              <span>
                {draft.relation} → <code>[[{draft.to}]]</code>
              </span>
            )}
          </Draft>
        )}
      </header>
      <article className="rounded-xl border bg-card p-5">
        <Response text={content} wikiLinks={wikiLinks} />
      </article>
    </Shell>
  );
}

/** Read-only preview of what a bot wants to do to the wiki. The state is in the URL; nothing is written. */
export function WikiDraftPage({ d }: { d: string | undefined }) {
  const draft = decodeDraft(d);
  const { wikiLinks } = useWikiIndex();
  if (!draft)
    return (
      <Shell title="Draft not found">
        <h1>Draft not found</h1>
        <Empty>
          This link holds no draft. It may be cut short. Ask the bot to suggest the change again.
        </Empty>
      </Shell>
    );
  if (draft.action !== "write") return <Change draft={draft} />;
  return (
    <Shell title={draft.title}>
      <header className="space-y-2">
        <h1 className="text-balance">{draft.title}</h1>
        <Draft
          note={
            <>
              Would be saved as <code>[[{draft.slug}]]</code>.
            </>
          }
        />
        {draft.tags.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {draft.tags.map((t) => (
              <Badge key={t}>#{t}</Badge>
            ))}
          </p>
        )}
      </header>
      {draft.howto && (
        <section aria-label="When to use" className="rounded-lg border bg-muted/40 p-4 text-sm">
          <h2 className="text-xs font-medium text-muted-foreground">When to use</h2>
          <p className="mt-1">{draft.howto}</p>
        </section>
      )}
      <article className="rounded-xl border bg-card p-5">
        <Response text={draft.content} wikiLinks={wikiLinks} />
      </article>
    </Shell>
  );
}
