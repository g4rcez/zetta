import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { relativeTime } from "../shared/relative-time";
import { BotPicker } from "../skills/bot-picker";
import { Badge, card, Empty, Loading } from "../shared/ui";
import {
  appsApi,
  appsQueries,
  type AppCallRow,
  type AppDetail,
  type CallStatus,
  type ToolManifest,
  type ToolPolicy,
} from "./apps-api";
import { formatSize } from "../artifacts/artifacts-api";
import { AppFrame } from "./app-frame";
import type { AppSearch } from "./apps-search";

type Tab = "open" | "tools" | "data" | "versions" | "bots" | "calls";
const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "tools", label: "Tools" },
  { id: "data", label: "Data" },
  { id: "versions", label: "Versions" },
  { id: "bots", label: "Bots" },
  { id: "calls", label: "Calls" },
];
const NONE: Bot[] = [];
const POLICIES: { value: ToolPolicy | null; label: string; hint: string }[] = [
  { value: null, label: "Default", hint: "Do what the tool declares" },
  { value: "ask", label: "Ask", hint: "Ask me before every call" },
  { value: "auto", label: "Auto", hint: "Never ask me" },
  { value: "block", label: "Block", hint: "Never run" },
];
const STATUS: Record<
  CallStatus,
  { label: string; tone: "success" | "danger" | "warning" | "neutral" }
> = {
  ok: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  denied: { label: "Refused", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  running: { label: "Running", tone: "neutral" },
  pending_approval: { label: "Waiting for you", tone: "warning" },
};

/** One app: its tools and how each is guarded, its versions, which bots may use it, and its calls. Only the owner changes it. */
export function AppPage({
  appRef,
  search,
  setSearch,
  onLeave,
}: {
  appRef: string;
  search: AppSearch;
  setSearch: (patch: Partial<Record<keyof AppSearch, string | undefined>>) => void;
  onLeave: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery(appsQueries.detail(appRef));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const app = detail.data;
  // An app with a page opens on it; one with tools only opens on its tools. The default stays out of the address.
  const defaultTab: Tab = app?.ui ? "open" : "tools";
  // The Data tab exists for an app with a tool that declares storage.
  const keepsData = app?.manifest?.tools.some((t) => t.storage) ?? false;
  const tab: Tab = search.tab ?? defaultTab;

  /** Runs a change, shows its error, and refreshes everything about apps. */
  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError(undefined);
    try {
      await work();
      await qc.invalidateQueries({ queryKey: ["apps"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl min-w-0 shrink-0 space-y-6 p-4 md:p-8">
        <Link
          to="/apps"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" /> Apps
        </Link>
        {detail.isPending ? (
          <Loading />
        ) : detail.error || !app ? (
          <p role="alert" className="text-sm text-destructive">
            {detail.error ? errorMessage(detail.error) : "That app is gone."}
          </p>
        ) : (
          <>
            <header className="space-y-2 border-b pb-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl text-balance">{app.name}</h1>
                  <p className="text-sm text-muted-foreground">
                    <code>apps.{app.slug}</code> ·{" "}
                    {app.version ? `version ${app.version}` : "not published"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={app.visibility === "team" ? "info" : "neutral"}>
                    {!app.isOwner
                      ? "Team app"
                      : app.visibility === "team"
                        ? "Shared with the team"
                        : "Private"}
                  </Badge>
                  {app.isOwner && app.sourcePlaygroundId && (
                    <Link
                      to="/playground/$id"
                      params={{ id: app.sourcePlaygroundId }}
                      className="text-sm underline"
                    >
                      Edit the code
                    </Link>
                  )}
                </div>
              </div>
              {app.description && (
                <p className="text-sm text-pretty text-muted-foreground">{app.description}</p>
              )}
              {app.isOwner && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== undefined}
                    onClick={() =>
                      void act("Sharing", () =>
                        appsApi.update(app.id, {
                          visibility: app.visibility === "team" ? "private" : "team",
                        }),
                      )
                    }
                  >
                    {app.visibility === "team" ? "Make private" : "Share with the team"}
                  </Button>
                  {confirming ? (
                    <span
                      role="group"
                      aria-label={`Archive ${app.name}? Its calls are kept.`}
                      className="inline-flex gap-1"
                    >
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy !== undefined}
                        onClick={() =>
                          void act(
                            "Archiving",
                            async () => (await appsApi.archive(app.id), onLeave()),
                          )
                        }
                      >
                        Archive it
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                      Archive
                    </Button>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </header>
            <div role="group" aria-label="App" className="flex flex-wrap gap-1">
              {TABS.filter(
                (t) => (t.id !== "open" || app.ui) && (t.id !== "data" || keepsData),
              ).map((t) => (
                <Button
                  key={t.id}
                  size="sm"
                  variant={tab === t.id ? "default" : "outline"}
                  aria-pressed={tab === t.id}
                  onClick={() => setSearch({ tab: t.id === defaultTab ? undefined : t.id })}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            {tab === "tools" && <ToolsSection app={app} busy={busy !== undefined} act={act} />}
            {tab === "data" && keepsData && (
              <DataSection appRef={appRef} isOwner={app.isOwner} act={act} />
            )}
            {tab === "versions" && (
              <VersionsSection app={app} busy={busy !== undefined} act={act} />
            )}
            {tab === "bots" && <BotsSection appRef={appRef} act={act} />}
            {tab === "calls" && <CallsSection appRef={appRef} />}
          </>
        )}
      </div>
      {/* The app page uses the full width of the content area and has no border of its own. */}
      {tab === "open" && app?.ui && <AppFrame appRef={appRef} className="flex-1" />}
    </div>
  );
}

type Act = (label: string, work: () => Promise<unknown>) => Promise<void>;

function ToolsSection({ app, busy, act }: { app: AppDetail; busy: boolean; act: Act }) {
  const tools = app.manifest?.tools ?? [];
  if (!tools.length) return <Empty>This app has no published tools.</Empty>;
  return (
    <ul className="space-y-3">
      {tools.map((t) => (
        <ToolCard key={t.name} app={app} tool={t} busy={busy} act={act} />
      ))}
    </ul>
  );
}

function ToolCard({
  app,
  tool,
  busy,
  act,
}: {
  app: AppDetail;
  tool: ToolManifest;
  busy: boolean;
  act: Act;
}) {
  const [open, setOpen] = useState(false);
  const chosen = app.settings.toolPolicy?.[tool.name] ?? null;
  return (
    <li className={`${card} min-w-0 space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <code className="text-sm">{tool.name}</code>
          <p className="text-sm text-pretty text-muted-foreground">
            {tool.description || "No description."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={tool.kind === "mutation" ? "warning" : "neutral"}>
            {tool.kind === "mutation" ? "Changes something" : "Reads"}
          </Badge>
          <span className="text-xs text-muted-foreground">{app.policies[tool.name]}</span>
        </div>
      </div>
      {tool.accounts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Needs an account: {tool.accounts.join(", ")}
        </p>
      )}
      {app.isOwner && (
        <div
          role="group"
          aria-label={`How ${tool.name} is guarded`}
          className="flex flex-wrap gap-1"
        >
          {POLICIES.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant={chosen === p.value ? "default" : "outline"}
              aria-pressed={chosen === p.value}
              title={p.hint}
              disabled={busy}
              onClick={() =>
                void act("Saving", () => appsApi.setPolicy(app.id, tool.name, p.value))
              }
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground underline"
      >
        {open ? "Hide the input" : "Show the input"}
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto rounded bg-muted/60 p-2 text-xs break-words whitespace-pre-wrap">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      )}
    </li>
  );
}

function VersionsSection({ app, busy, act }: { app: AppDetail; busy: boolean; act: Act }) {
  if (!app.versions.length) return <Empty>Nothing was published yet.</Empty>;
  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card">
      {app.versions.map((v) => (
        <li
          key={v.id}
          className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <p>
              Version {v.n} {v.active && <Badge tone="success">Active</Badge>}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {v.note || "No note"} · {v.tools} {v.tools === 1 ? "tool" : "tools"} ·{" "}
              {relativeTime(v.createdAt)}
              {v.publishedByBotId ? " · asked for by a bot" : ""}
            </p>
          </div>
          {app.isOwner && !v.active && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act("Rolling back", () => appsApi.rollback(app.id, v.n))}
            >
              Use version {v.n}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function BotsSection({ appRef, act }: { appRef: string; act: Act }) {
  const botsQuery = useQuery(chatQueries.bots());
  const granted = useQuery(appsQueries.bots(appRef));
  const mine = (botsQuery.data ?? NONE).filter((b) => b.canEdit);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (granted.data) setSelected(granted.data);
  }, [granted.data]);
  if (granted.isPending || botsQuery.isPending) return <Loading />;
  const changed =
    selected.length !== (granted.data ?? []).length ||
    selected.some((id) => !(granted.data ?? []).includes(id));
  return (
    <div className={`${card} space-y-3`}>
      <p className="text-sm text-pretty text-muted-foreground">
        A bot can search and call this app's tools only when you allow it here. It never sees an
        account's secret.
      </p>
      <BotPicker bots={mine} selected={selected} onChange={setSelected} />
      <Button
        size="sm"
        disabled={!changed}
        onClick={() => void act("Saving", () => appsApi.setBots(appRef, selected))}
      >
        Save bots
      </Button>
    </div>
  );
}

/** The two-step confirmation before records are deleted: the destructive button, and a way to back out. */
function ConfirmClear({
  scope,
  onConfirm,
  onKeep,
}: {
  scope: "mine" | "all";
  onConfirm: () => void;
  onKeep: () => void;
}) {
  return (
    <span
      role="group"
      aria-label={
        scope === "mine"
          ? "Delete your records of this app? This cannot be undone."
          : "Delete every person's records of this app? This cannot be undone."
      }
      className="inline-flex gap-1"
    >
      <Button size="sm" variant="destructive" onClick={onConfirm}>
        {scope === "mine" ? "Delete my records" : "Delete everyone's records"}
      </Button>
      <Button size="sm" variant="outline" onClick={onKeep}>
        Keep
      </Button>
    </span>
  );
}

/** What the app keeps. Numbers only: the page and the tools are how the content is read and changed. */
function DataSection({ appRef, isOwner, act }: { appRef: string; isOwner: boolean; act: Act }) {
  const data = useQuery(appsQueries.data(appRef));
  const [asking, setAsking] = useState<"mine" | "all">();
  if (data.isPending) return <Loading />;
  if (data.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(data.error)}
      </p>
    );
  const { collections } = data.data;
  if (!collections.length) return <Empty>This app keeps nothing.</Empty>;
  const clear = (scope: "mine" | "all") =>
    void act("Deleting data", async () => {
      await appsApi.clearData(appRef, scope);
      setAsking(undefined);
    });
  return (
    <div className="space-y-4">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {collections.map((c) => (
          <li
            key={c.name}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <code className="text-xs">{c.name}</code>
              <p className="text-xs text-muted-foreground">
                {c.kind === "shared" ? "Shared by everyone who uses the app" : "One set per person"}
                {c.otherRecords ? ` · ${c.otherRecords} held by other people` : ""}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {c.records} {c.records === 1 ? "record" : "records"} · {formatSize(c.bytes)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {asking === "mine" ? (
          <ConfirmClear
            scope="mine"
            onConfirm={() => clear("mine")}
            onKeep={() => setAsking(undefined)}
          />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAsking("mine")}>
            Delete my records
          </Button>
        )}
        {isOwner &&
          (asking === "all" ? (
            <ConfirmClear
              scope="all"
              onConfirm={() => clear("all")}
              onKeep={() => setAsking(undefined)}
            />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAsking("all")}>
              Delete everyone's records
            </Button>
          ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Publishing a new version or going back to an old one never changes these records. Only
        deleting does.
      </p>
    </div>
  );
}

function CallsSection({ appRef }: { appRef: string }) {
  const calls = useQuery(appsQueries.calls(appRef));
  if (calls.isPending) return <Loading />;
  if (calls.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(calls.error)}
      </p>
    );
  if (!calls.data.length) return <Empty>No calls yet.</Empty>;
  return (
    <>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {calls.data.map((c) => (
          <CallLine key={c.id} call={c} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        A call that waits for you has its card in the chat or in your Inbox.
      </p>
    </>
  );
}

function CallLine({ call }: { call: AppCallRow }) {
  const s = STATUS[call.status];
  return (
    <li className="flex min-w-0 items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <code className="text-xs">{call.tool}</code>
        <p className="truncate text-xs text-muted-foreground">
          {call.source} · {relativeTime(call.createdAt)}
          {call.durationMs !== null ? ` · ${call.durationMs} ms` : ""}
        </p>
        {call.error && <p className="text-xs break-words text-destructive">{call.error}</p>}
      </div>
      <Badge tone={s.tone}>{s.label}</Badge>
    </li>
  );
}
