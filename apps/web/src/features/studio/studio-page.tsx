import {
  PulseIcon as ActivityIcon,
  ChatTeardropTextIcon,
  GitBranchIcon,
  TrayIcon,
  KeyIcon,
  DevicesIcon,
  PlugIcon,
  SignpostIcon,
  UsersIcon,
  SquaresFourIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useRef, useState } from "react";

import { type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Loading } from "../shared/ui";
import { isRailTab, isStudioTab, studioTabs } from "./studio-tabs";
import { useLoadError } from "./studio-queries";
import { Alert } from "@g4rcez/components/alert";

// Each tab is its own chunk: opening Studio no longer downloads every tab (the workflow canvas alone pulls in @xyflow/react).
const Accounts = lazy(() => import("./accounts").then((m) => ({ default: m.Accounts })));
const Activity = lazy(() => import("./activity").then((m) => ({ default: m.Activity })));
const Attention = lazy(() => import("./attention").then((m) => ({ default: m.Attention })));
const Computer = lazy(() => import("./computer").then((m) => ({ default: m.Computer })));
const Decisions = lazy(() => import("./decisions").then((m) => ({ default: m.Decisions })));
const Overview = lazy(() => import("./overview").then((m) => ({ default: m.Overview })));
const Plugins = lazy(() => import("./plugins").then((m) => ({ default: m.Plugins })));
const Snapshots = lazy(() => import("./snapshots").then((m) => ({ default: m.Snapshots })));
const Workflows = lazy(() => import("./workflows").then((m) => ({ default: m.Workflows })));
const OutputStyles = lazy(() =>
  import("./output-styles").then((m) => ({ default: m.OutputStyles })),
);

const tabs = studioTabs.filter((t) => !isRailTab(t.slug)).map((t) => t.label);
type Tab = (typeof studioTabs)[number]["label"];
const ICON: Record<Tab, Icon> = {
  Overview: SquaresFourIcon,
  Inbox: TrayIcon,
  "Output styles": ChatTeardropTextIcon,
  Workflows: GitBranchIcon,
  Decisions: SignpostIcon,
  Accounts: KeyIcon,
  Computer: DevicesIcon,
  Plugins: PlugIcon,
  "Team snapshots": UsersIcon,
  Activity: ActivityIcon,
};
const NO_BOTS: Bot[] = [];

export function StudioPage() {
  const { tab: slug } = useParams({ from: "/_auth/studio/$tab" });
  const navigate = useNavigate();
  const current = studioTabs.find((t) => t.slug === slug) ?? studioTabs[0];
  const tab: Tab = current.label;
  const { data, error: botsError } = useQuery(chatQueries.bots());
  const bots = data ?? NO_BOTS;
  const [error, setError] = useState<string>();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useLoadError(botsError, setError);
  const select = (t: Tab) => {
    setError(undefined);
    const next = studioTabs.find((x) => x.label === t)!.slug;
    if (isStudioTab(next)) void navigate({ to: "/studio/$tab", params: { tab: next } });
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i + tabs.length - 1) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    select(tabs[to]!);
    tabRefs.current[to]?.focus();
  };
  // The plugin catalog is a full-width page: no section nav, no width cap.
  const full = tab === "Plugins";
  return (
    <div className="h-full overflow-y-auto">
      <div
        className={`mx-auto grid w-full grid-cols-[minmax(0,1fr)] gap-5 p-4 md:p-8 ${full ? "" : "max-w-6xl md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10"}`}
      >
        <nav
          aria-label="Studio sections"
          hidden={full}
          className="md:sticky md:top-8 md:self-start"
        >
          <h1 className="label-mono mb-3 hidden px-3 md:block">Studio</h1>
          <h1 className="sr-only md:hidden">Studio</h1>
          <div
            role="tablist"
            aria-label="Studio"
            aria-orientation="vertical"
            className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
          >
            {tabs.map((t, i) => {
              const Icon = ICON[t];
              const active = t === tab;
              return (
                <button
                  key={t}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  role="tab"
                  id={`tab-${i}`}
                  aria-selected={active}
                  aria-controls="studio-panel"
                  tabIndex={active || (i === 0 && !tabs.includes(tab)) ? 0 : -1}
                  onKeyDown={(e) => onKey(e, i)}
                  onClick={() => select(t)}
                  className={`relative flex shrink-0 touch-manipulation items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Icon aria-hidden="true" className={`size-4 ${active ? "text-primary" : ""}`} />
                  {t}
                </button>
              );
            })}
          </div>
        </nav>
        <div className="min-w-0 space-y-6">
          <header>
            <h2 className="text-2xl text-balance">{tab}</h2>
            <p className="text-sm text-pretty text-muted-foreground">{current.blurb}</p>
          </header>
          {error && <Alert theme="danger">{error}</Alert>}
          <div
            id="studio-panel"
            role="tabpanel"
            aria-labelledby={tabs.includes(tab) ? `tab-${tabs.indexOf(tab)}` : undefined}
            aria-label={tabs.includes(tab) ? undefined : tab}
            className="min-w-0"
          >
            <Suspense fallback={<Loading />}>
              {tab === "Overview" && <Overview onError={setError} />}
              {tab === "Inbox" && <Attention bots={bots} onError={setError} />}
              {tab === "Output styles" && <OutputStyles onError={setError} />}
              {tab === "Workflows" && <Workflows bots={bots} onError={setError} />}
              {tab === "Decisions" && <Decisions onError={setError} />}
              {tab === "Accounts" && <Accounts onError={setError} />}
              {tab === "Computer" && <Computer onError={setError} />}
              {tab === "Plugins" && <Plugins onError={setError} />}
              {tab === "Team snapshots" && <Snapshots onError={setError} />}
              {tab === "Activity" && <Activity bots={bots} onError={setError} />}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
