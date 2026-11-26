import {
  PulseIcon as ActivityIcon,
  ChatTeardropTextIcon,
  GearSixIcon,
  GitBranchIcon,
  KeyIcon,
  DevicesIcon,
  MicrophoneIcon,
  PhoneIcon,
  PlugIcon,
  SignpostIcon,
  UsersIcon,
  UserPlusIcon,
  SquaresFourIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Link, useNavigate, useParams, useRouteContext, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";

import { type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Loading } from "../shared/ui";
import { isRailTab, studioTabs } from "./studio-tabs";
import { useLoadError } from "./studio-queries";
import { Alert } from "@g4rcez/components/alert";

// Each tab is its own chunk: opening Studio no longer downloads every tab (the workflow canvas alone pulls in @xyflow/react).
const Accounts = lazy(() => import("./accounts").then((m) => ({ default: m.Accounts })));
import { parseActivityView } from "./activity-view";
import { parsePhoneSearch, type PhoneSearch } from "../phone/phone-filters";
import { parsePluginsSearch, type PluginsSearch } from "./plugins-filters";
import { parseSettingsSearch, type SettingsSearch } from "./settings-filters";
import { isRootIdentity } from "@/lib/identity-client";
const Activity = lazy(() => import("./activity").then((m) => ({ default: m.Activity })));
const Computer = lazy(() => import("./computer").then((m) => ({ default: m.Computer })));
const Invites = lazy(() => import("./invites").then((m) => ({ default: m.Invites })));
const Voice = lazy(() => import("./voice").then((m) => ({ default: m.Voice })));
const Decisions = lazy(() => import("./decisions").then((m) => ({ default: m.Decisions })));
const Overview = lazy(() => import("./overview").then((m) => ({ default: m.Overview })));
const Plugins = lazy(() => import("./plugins").then((m) => ({ default: m.Plugins })));
const Snapshots = lazy(() => import("./snapshots").then((m) => ({ default: m.Snapshots })));
const Workflows = lazy(() => import("./workflows").then((m) => ({ default: m.Workflows })));
const PhoneNumbersPage = lazy(() =>
  import("../phone/phone-admin").then((m) => ({ default: m.PhoneNumbersPage })),
);
const ServerSettingsPage = lazy(() =>
  import("./server-settings").then((m) => ({ default: m.ServerSettingsPage })),
);
const OutputStyles = lazy(() =>
  import("./output-styles").then((m) => ({ default: m.OutputStyles })),
);

const allTabs = studioTabs.filter((t) => !isRailTab(t.slug));
/** The sections an administrator alone sees in the side nav. */
const ADMIN_TABS: readonly string[] = ["phone", "settings"];
type Tab = (typeof studioTabs)[number]["label"];
const ICON: Record<Tab, Icon> = {
  Overview: SquaresFourIcon,
  "Output styles": ChatTeardropTextIcon,
  Workflows: GitBranchIcon,
  Decisions: SignpostIcon,
  Accounts: KeyIcon,
  Computer: DevicesIcon,
  Plugins: PlugIcon,
  "Team snapshots": UsersIcon,
  People: UserPlusIcon,
  "Phone numbers": PhoneIcon,
  Voice: MicrophoneIcon,
  "Server settings": GearSixIcon,
  Activity: ActivityIcon,
};
const NO_BOTS: Bot[] = [];

export function StudioPage() {
  const { tab: slug } = useParams({ from: "/_auth/studio/$tab" });
  const { identity } = useRouteContext({ from: "/_auth/studio/$tab" });
  const search = useSearch({ from: "/_auth/studio/$tab" });
  const navigate = useNavigate();
  const current = studioTabs.find((t) => t.slug === slug) ?? studioTabs[0];
  const tab: Tab = current.label;
  const tabs = allTabs.filter((t) => identity.isAdmin || !ADMIN_TABS.includes(t.slug));
  const { data, error: botsError } = useQuery(chatQueries.bots());
  const bots = data ?? NO_BOTS;
  const [error, setError] = useState<string>();
  useLoadError(botsError, setError);
  const phoneSearch = parsePhoneSearch(search);
  const setPhoneSearch = (next: PhoneSearch, how: "push" | "replace") =>
    void navigate({
      to: "/studio/$tab",
      params: { tab: "phone" },
      search: next,
      replace: how === "replace",
    });
  const settingsSearch = parseSettingsSearch(search);
  const setSettingsSearch = (next: SettingsSearch, how: "push" | "replace") =>
    void navigate({
      to: "/studio/$tab",
      params: { tab: "settings" },
      search: next,
      replace: how === "replace",
    });
  const pluginsSearch = parsePluginsSearch(search);
  const setPluginsSearch = (next: PluginsSearch, how: "push" | "replace") =>
    void navigate({
      to: "/studio/$tab",
      params: { tab: "plugins" },
      search: next,
      replace: how === "replace",
    });
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
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
            {tabs.map(({ slug: to, label }) => {
              const Icon = ICON[label];
              const active = label === tab;
              return (
                <Link
                  key={to}
                  to="/studio/$tab"
                  params={{ tab: to }}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setError(undefined)}
                  className={`relative flex shrink-0 touch-manipulation items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-accent font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </Link>
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
          <div id="studio-panel" className="min-w-0">
            <Suspense fallback={<Loading />}>
              {tab === "Overview" && <Overview onError={setError} />}
              {tab === "Output styles" && <OutputStyles onError={setError} />}
              {tab === "Workflows" && <Workflows bots={bots} onError={setError} />}
              {tab === "Decisions" && <Decisions onError={setError} />}
              {tab === "Accounts" && <Accounts onError={setError} />}
              {tab === "Computer" && <Computer onError={setError} />}
              {tab === "Plugins" && (
                <Plugins onError={setError} search={pluginsSearch} setSearch={setPluginsSearch} />
              )}
              {tab === "Team snapshots" && <Snapshots onError={setError} />}
              {tab === "People" && <Invites isAdmin={identity.isAdmin} />}
              {tab === "Phone numbers" && (
                <PhoneNumbersPage
                  admin={identity.isAdmin}
                  root={isRootIdentity(identity)}
                  search={phoneSearch}
                  setSearch={setPhoneSearch}
                />
              )}
              {tab === "Voice" && <Voice />}
              {tab === "Server settings" && (
                <ServerSettingsPage
                  admin={identity.isAdmin}
                  root={isRootIdentity(identity)}
                  search={settingsSearch}
                  setSearch={setSettingsSearch}
                />
              )}
              {tab === "Activity" && (
                <Activity
                  bots={bots}
                  onError={setError}
                  view={parseActivityView(search.view)}
                  onView={(view) =>
                    void navigate({
                      to: "/studio/$tab",
                      params: { tab: "activity" },
                      search: view === "trail" ? {} : { view },
                      replace: true,
                    })
                  }
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
