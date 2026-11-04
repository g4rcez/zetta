import { Link } from "@tanstack/react-router";

import { Button, Input } from "@/components/ui";
import { call } from "../chat/chat-client";
import { Response, type WikiLinkInfo } from "../chat/response";
import { Badge } from "../shared/ui";
import { Fields, contentFields } from "./item-fields";
import { LinkLists } from "./item-side";
import { useAction } from "./use-action";
import { path, type Detail } from "./wiki-api";

/** An item another member published: read only, with a form to suggest a change their owner decides on. */
export function SharedItem({
  detail,
  wikiLinks,
}: {
  detail: Extract<Detail, { access: "shared" }>;
  wikiLinks: WikiLinkInfo | undefined;
}) {
  const { run, feedback } = useAction(() => undefined);
  const p = detail.page;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to="/memory" className="hover:underline">
          Memory
        </Link>{" "}
        / {p.title}
      </nav>
      <header className="space-y-2">
        <h1 className="text-balance">{p.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone="info">Shared</Badge>
          by {detail.ownerName} · version {p.version} · read only. Suggest a change and{" "}
          {detail.ownerName} decides.
        </p>
        {p.status === "stale" && (
          <p className="text-sm">
            <Badge tone="warning">Marked stale</Badge> This item may be out of date.
          </p>
        )}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {p.howto && (
            <section aria-label="When to use" className="rounded-lg border bg-muted/40 p-4 text-sm">
              <h2 className="text-xs font-medium text-muted-foreground">When to use</h2>
              <p className="mt-1">{p.howto}</p>
            </section>
          )}
          <article className="rounded-xl border bg-card p-5">
            <Response text={p.content} wikiLinks={wikiLinks} />
          </article>
          <form
            className="space-y-2 rounded-xl border bg-card p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  call(`${path(p.slug)}/suggestions`, "POST", {
                    ...contentFields(f),
                    reason: String(f.get("reason") ?? "").trim(),
                  }),
                `Sent to ${detail.ownerName}.`,
              );
            }}
          >
            <h2 className="text-sm font-medium">Suggest a change</h2>
            <Fields page={p} />
            <Input title="Why (optional)" name="reason" maxLength={500} />
            <Button size="sm" type="submit">
              Send suggestion
            </Button>
            {feedback}
          </form>
        </div>
        <aside className="min-w-0 space-y-5">
          <LinkLists links={detail.links} linkedFrom={detail.linkedFrom} />
        </aside>
      </div>
    </div>
  );
}
