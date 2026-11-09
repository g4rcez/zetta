import { AppWindowIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { relativeTime } from "../shared/relative-time";
import { Badge, card, Empty, Loading } from "../shared/ui";
import { appsQueries, type AppSummary, type ToolHit } from "./apps-api";
import type { AppsSearch } from "./apps-search";

type Tab = "apps" | "tools";
const TABS: { id: Tab; label: string }[] = [
  { id: "apps", label: "Apps" },
  { id: "tools", label: "Tools" },
];

/** The address of an app: its slug for the person's own, its id for a team app (two people may use the same slug). */
export const appRef = (a: Pick<AppSummary, "slug" | "id" | "ownerUserId">, userId: string) =>
  a.ownerUserId === userId ? a.slug : a.id;

/**
 * Apps: code that was published so bots, routines and workflows can call its tools. The apps you can use, and a search over every tool.
 * Writing one happens in the Playground; this page is where it is published, guarded and handed to bots.
 */
export function AppsPage({
  userId,
  search,
  setSearch,
}: {
  userId: string;
  /** The view, as it is in the address. */
  search: AppsSearch;
  setSearch: (
    patch: Partial<Record<keyof AppsSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
}) {
  const tab: Tab = search.tab ?? "apps";
  const list = useQuery(appsQueries.list());
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <AppWindowIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">Apps</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Code you published so bots, routines and workflows can call its tools. A tool that
              changes something asks you first, unless you say otherwise.
            </p>
          </div>
        </header>
        <div role="group" aria-label="Apps" className="flex gap-1">
          {TABS.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={tab === t.id ? "default" : "outline"}
              aria-pressed={tab === t.id}
              onClick={() => setSearch({ tab: t.id === "tools" ? "tools" : undefined })}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {tab === "apps" ? (
          list.isPending ? (
            <Loading />
          ) : list.error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(list.error)}
            </p>
          ) : (
            <AppCards apps={list.data} userId={userId} />
          )
        ) : (
          <ToolsTab apps={list.data ?? []} userId={userId} search={search} setSearch={setSearch} />
        )}
      </div>
    </div>
  );
}

function AppCards({ apps, userId }: { apps: AppSummary[]; userId: string }) {
  if (!apps.length)
    return (
      <Empty>
        No apps yet. Write one in the{" "}
        <Link to="/playground" className="underline">
          Playground
        </Link>{" "}
        (TypeScript or JavaScript, with <code>defineApp</code> from <code>zetta-app</code>), then
        press Publish.
      </Empty>
    );
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {apps.map((a) => (
        <li key={a.id} className={`${card} min-w-0 space-y-2`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base">
                <Link
                  to="/apps/$ref"
                  params={{ ref: appRef(a, userId) }}
                  className="hover:underline"
                >
                  {a.name}
                </Link>
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {a.slug} · {a.version ? `v${a.version}` : "not published"} · {a.tools}{" "}
                {a.tools === 1 ? "tool" : "tools"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {a.ui && <Badge tone="success">Has a page</Badge>}
              <Badge tone={a.visibility === "team" ? "info" : "neutral"}>
                {a.ownerUserId !== userId
                  ? "Team app"
                  : a.visibility === "team"
                    ? "Shared"
                    : "Private"}
              </Badge>
            </div>
          </div>
          {a.description && (
            <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">
              {a.description}
            </p>
          )}
          {a.accounts.length > 0 && (
            <p className="text-xs text-muted-foreground">Needs: {a.accounts.join(", ")}</p>
          )}
          <p className="text-xs text-muted-foreground">Updated {relativeTime(a.updatedAt)}</p>
        </li>
      ))}
    </ul>
  );
}

function ToolsTab({
  apps,
  userId,
  search,
  setSearch,
}: {
  apps: AppSummary[];
  userId: string;
  search: AppsSearch;
  setSearch: (patch: Partial<Record<keyof AppsSearch, string | undefined>>) => void;
}) {
  // The box holds a draft; it reaches the address when the person submits, so Back and a pasted link show the same results.
  const [draft, setDraft] = useState(search.q ?? "");
  useEffect(() => setDraft(search.q ?? ""), [search.q]);
  const results = useQuery(appsQueries.tools(search.q ?? "", ""));
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch({ q: draft.trim() || undefined });
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            title="Search tools"
            value={draft}
            maxLength={200}
            placeholder="remove an item"
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm">
          <MagnifyingGlassIcon aria-hidden="true" /> Search
        </Button>
      </form>
      {results.isPending ? (
        <Loading />
      ) : results.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(results.error)}
        </p>
      ) : !results.data.length ? (
        <Empty>No tools match. Publish an app, or try other words.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {results.data.map((t) => (
            <ToolRow key={t.path} tool={t} app={bySlug.get(t.app)} userId={userId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolRow({
  tool,
  app,
  userId,
}: {
  tool: ToolHit;
  app: AppSummary | undefined;
  userId: string;
}) {
  const body = (
    <>
      <code className="block truncate text-xs">{tool.path}</code>
      <span className="block text-muted-foreground">{tool.description}</span>
    </>
  );
  return (
    <li className="flex min-w-0 items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        {app ? (
          <Link to="/apps/$ref" params={{ ref: appRef(app, userId) }} className="block min-w-0">
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={tool.kind === "mutation" ? "warning" : "neutral"}>
          {tool.kind === "mutation" ? "Changes something" : "Reads"}
        </Badge>
        <span className="text-xs text-muted-foreground">{tool.policy}</span>
      </div>
    </li>
  );
}
