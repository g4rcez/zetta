import {
  Activity as ActivityIcon,
  BookOpen,
  CalendarClock,
  GitBranch,
  Inbox,
  KeyRound,
  MonitorSmartphone,
  Plug,
  Route,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { Accounts } from "./accounts";
import { Activity } from "./activity";
import { Attention } from "./attention";
import { Computer } from "./computer";
import { Decisions } from "./decisions";
import { Knowledge } from "./knowledge";
import { Plugins } from "./plugins";
import { Routines } from "./routines";
import { Snapshots } from "./snapshots";
import { isRailTab, isStudioTab, studioTabs } from "./studio-tabs";
import { Workflows } from "./workflows";
import { Alert } from "@g4rcez/components/alert";

const tabs = studioTabs.filter((t) => !isRailTab(t.slug)).map((t) => t.label);
type Tab = (typeof studioTabs)[number]["label"];
const ICON: Record<Tab, LucideIcon> = {
  Routines: CalendarClock,
  Notifications: Inbox,
  Knowledge: BookOpen,
  Workflows: GitBranch,
  Decisions: Route,
  Accounts: KeyRound,
  Computer: MonitorSmartphone,
  Plugins: Plug,
  "Team snapshots": Users,
  Activity: ActivityIcon,
};
const BLURB: Record<Tab, string> = {
  Plugins: "Connect tools and MCP servers, then choose which bots may use them.",
  Routines: "Schedule bots to work for you.",
  Notifications: "Things that need you, with the actions to deal with them.",
  Knowledge: "What your bots remember, reusable instructions and sources.",
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
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-5 p-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 md:p-8">
        <nav aria-label="Studio sections" className="md:sticky md:top-8 md:self-start">
          <h1 className="mb-3 hidden px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:block">
            Studio
          </h1>
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
                  className={`relative flex shrink-0 touch-manipulation items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-accent font-medium text-accent-foreground md:before:absolute md:before:inset-y-2 md:before:-left-px md:before:w-0.5 md:before:rounded-full md:before:bg-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
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
              <h2 className="text-2xl font-semibold tracking-tight text-balance">{tab}</h2>
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
            {tab === "Routines" && <Routines bots={bots} onError={setError} />}
            {tab === "Notifications" && <Attention bots={bots} onError={setError} />}
            {tab === "Knowledge" && <Knowledge onError={setError} />}
            {tab === "Workflows" && <Workflows bots={bots} onError={setError} />}
            {tab === "Decisions" && <Decisions onError={setError} />}
            {tab === "Accounts" && <Accounts onError={setError} />}
            {tab === "Computer" && <Computer onError={setError} />}
            {tab === "Plugins" && <Plugins bots={bots} onError={setError} />}
            {tab === "Team snapshots" && <Snapshots onError={setError} />}
            {tab === "Activity" && <Activity bots={bots} onError={setError} />}
          </div>
        </div>
      </div>
    </div>
  );
}
