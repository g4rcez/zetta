import { Activity as ActivityIcon, BookOpen, CalendarClock, GitBranch, Inbox, KeyRound, MonitorSmartphone, Route, Users, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { Accounts } from "./accounts";
import { Activity } from "./activity";
import { Attention } from "./attention";
import { Computer } from "./computer";
import { Decisions } from "./decisions";
import { Knowledge } from "./knowledge";
import { Routines } from "./routines";
import { Snapshots } from "./snapshots";
import { Workflows } from "./workflows";

const tabs = ["Routines", "Attention", "Knowledge", "Workflows", "Decisions", "Accounts", "Computer", "Team snapshots", "Activity"] as const;
type Tab = (typeof tabs)[number];
const ICON: Record<Tab, LucideIcon> = { Routines: CalendarClock, Attention: Inbox, Knowledge: BookOpen, Workflows: GitBranch, Decisions: Route, Accounts: KeyRound, Computer: MonitorSmartphone, "Team snapshots": Users, Activity: ActivityIcon };
const BLURB: Record<Tab, string> = { Routines: "Schedule bots to work for you.", Attention: "Things that need a human decision.", Knowledge: "What your bots remember, reusable instructions and sources.", Workflows: "Chain steps across bots and sources.", Decisions: "How messages are routed.", Accounts: "Engines and provider keys.", Computer: "Browser and desktop sessions.", "Team snapshots": "Read-only copies shared with your team.", Activity: "A privacy-safe trail of what happened." };

export function StudioPage() {
  const [tab, setTab] = useState<Tab>("Routines");
  const [bots, setBots] = useState<Bot[]>([]);
  const [error, setError] = useState<string>();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { chatClient.bots().then(setBots).catch((e) => setError(errorMessage(e))); }, []);
  const select = (t: Tab) => { setTab(t); setError(undefined); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); select(tabs[to]!); tabRefs.current[to]?.focus();
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-10 md:p-8">
        <div role="tablist" aria-label="Studio" aria-orientation="vertical" className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-0 md:flex-col md:self-start md:overflow-visible">
          <h1 className="mb-2 hidden px-3 md:block">Studio</h1>
          {tabs.map((t, i) => { const Icon = ICON[t]; return (
            <button key={t} ref={(el) => { tabRefs.current[i] = el; }} role="tab" id={`tab-${i}`} aria-selected={t === tab} aria-controls="studio-panel" tabIndex={t === tab ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => select(t)}
              className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${t === tab ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon aria-hidden="true" className="size-4" />{t}</button>); })}
        </div>
        <div className="min-w-0 space-y-5">
          <div><h2 className="text-2xl font-semibold tracking-tight">{tab}</h2><p className="text-sm text-muted-foreground">{BLURB[tab]}</p></div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div id="studio-panel" role="tabpanel" aria-labelledby={`tab-${tabs.indexOf(tab)}`} className="min-w-0">
            {tab === "Routines" && <Routines bots={bots} onError={setError} />}
            {tab === "Attention" && <Attention bots={bots} onError={setError} />}
            {tab === "Knowledge" && <Knowledge onError={setError} />}
            {tab === "Workflows" && <Workflows bots={bots} onError={setError} />}
            {tab === "Decisions" && <Decisions onError={setError} />}
            {tab === "Accounts" && <Accounts onError={setError} />}
            {tab === "Computer" && <Computer onError={setError} />}
            {tab === "Team snapshots" && <Snapshots onError={setError} />}
            {tab === "Activity" && <Activity bots={bots} onError={setError} />}
          </div>
        </div>
      </div>
    </div>
  );
}
