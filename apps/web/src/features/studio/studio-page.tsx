import {
  PulseIcon as ActivityIcon,
  BookOpenIcon,
  CalendarDotsIcon,
  GitBranchIcon,
  ListChecksIcon,
  TrayIcon,
  KeyIcon,
  BooksIcon,
  DevicesIcon,
  PlugIcon,
  SignpostIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useRef, useState } from "react";

import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { Loading } from "../shared/ui";
import { isRailTab, isStudioTab, studioTabs } from "./studio-tabs";
import { Alert } from "@g4rcez/components/alert";

// Each tab is its own chunk: opening Studio no longer downloads every tab (the workflow canvas alone pulls in @xyflow/react).
const Accounts = lazy(() => import("./accounts").then((m) => ({ default: m.Accounts })));
const Activity = lazy(() => import("./activity").then((m) => ({ default: m.Activity })));
const Attention = lazy(() => import("./attention").then((m) => ({ default: m.Attention })));
const Computer = lazy(() => import("./computer").then((m) => ({ default: m.Computer })));
const Decisions = lazy(() => import("./decisions").then((m) => ({ default: m.Decisions })));
const Wiki = lazy(() => import("./wiki").then((m) => ({ default: m.Wiki })));
const Plugins = lazy(() => import("./plugins").then((m) => ({ default: m.Plugins })));
const Routines = lazy(() => import("./routines").then((m) => ({ default: m.Routines })));
const Snapshots = lazy(() => import("./snapshots").then((m) => ({ default: m.Snapshots })));
const Workflows = lazy(() => import("./workflows").then((m) => ({ default: m.Workflows })));
const Knowledge = lazy(() => import("./knowledge").then((m) => ({ default: m.Knowledge })));
const Instructions = lazy(() => import("./knowledge").then((m) => ({ default: m.Instructions })));

const tabs = studioTabs.filter((t) => !isRailTab(t.slug)).map((t) => t.label);
type Tab = (typeof studioTabs)[number]["label"];
const ICON: Record<Tab, Icon> = {
  Routines: CalendarDotsIcon,
  Inbox: TrayIcon,
  Knowledge: BookOpenIcon,
  Wiki: BooksIcon,
  Instructions: ListChecksIcon,
  Workflows: GitBranchIcon,
  Decisions: SignpostIcon,
  Accounts: KeyIcon,
  Computer: DevicesIcon,
  Plugins: PlugIcon,
  "Team snapshots": UsersIcon,
  Activity: ActivityIcon,
};
const BLURB: Record<Tab, string> = {
  Plugins: "Connect tools and MCP servers, then choose which bots may use them.",
  Routines: "Schedule bots to work for you.",
  Inbox: "Things that need you, with the actions to deal with them.",
  Knowledge: "What your bots remember and the sources they can read.",
  Wiki: "Pages your bots share about what they learned, so no bot does the same work twice.",
  Instructions: "Saved steps your bots follow. Type / in a chat to use one.",
  Workflows: "Chain steps across bots and sources.",
  Decisions: "How messages are routed.",
  Accounts: "Engines and provider keys.",
  Computer: "Browser and desktop sessions.",
  "Team snapshots": "Read-only copies shared with your team.",
  Activity: "A privacy-safe trail of what happened.",
};

export function StudioPage() {
  const { tab: slug } = useParams({ from: "/_auth/studio/$tab" });
  const navigate = useNavigate();
  const tab: Tab = (studioTabs.find((t) => t.slug === slug) ?? studioTabs[0]).label;
  const [bots, setBots] = useState<Bot[]>([]);
  const [error, setError] = useState<string>();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    chatClient
      .bots()
      .then(setBots)
      .catch((e) => setError(errorMessage(e)));
  }, []);
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
  const Current = ICON[tab];
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
          <header className="flex items-start gap-3 border-b pb-5">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
            >
              <Current className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-2xl text-balance">{tab}</h2>
              <p className="text-sm text-pretty text-muted-foreground">{BLURB[tab]}</p>
            </div>
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
              {tab === "Routines" && <Routines bots={bots} onError={setError} />}
              {tab === "Inbox" && <Attention bots={bots} onError={setError} />}
              {tab === "Knowledge" && <Knowledge onError={setError} />}
              {tab === "Wiki" && <Wiki onError={setError} />}
              {tab === "Instructions" && <Instructions onError={setError} />}
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
