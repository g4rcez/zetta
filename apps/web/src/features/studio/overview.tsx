import { CaretRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { outputStylesQueries } from "../output-styles/output-styles-api";
import { call } from "../chat/chat-client";
import { Badge, list, useList } from "../shared/ui";
import {
  connectionsQueries,
  decisionsQueries,
  harnessQueries,
  type Harness,
} from "./studio-queries";
import { studioTabs, type StudioTab } from "./studio-tabs";

/** One status: plain text, or a badge when a person has to look. A badge always carries a word. */
type Status = { text: string; tone?: "warning" | "danger" };
const CHECKING: Status = { text: "Checking…" };
const UNAVAILABLE: Status = { text: "Unavailable", tone: "danger" };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RECENT = 50;

function engines(rows: Harness[], accounts: number): Status {
  const ready = rows.filter((h) => h.status === "ready").length;
  const login = rows.filter((h) => h.status === "needs_login").length;
  const text = `${ready} of ${rows.length} engines ready · ${count(accounts, "account")}`;
  return login > 0
    ? {
        text: `${login === 1 ? "1 engine needs" : `${login} engines need`} sign-in · ${text}`,
        tone: "warning",
      }
    : { text };
}

function useStatus(onError: (m: string) => void): Partial<Record<StudioTab, Status>> {
  const styles = useQuery(outputStylesQueries.list());
  const [flows] = useList<unknown>("/api/workflows", "workflows", onError);
  const laya = useQuery(decisionsQueries.status());
  const harnesses = useQuery(harnessQueries.list());
  const connections = useQuery(connectionsQueries.list());
  const [snaps] = useList<unknown>("/api/snapshots", "snapshots", onError);
  const activity = useQuery({
    queryKey: ["activity", "overview"],
    queryFn: () => call<{ events: { outcome: string }[] }>(`/api/activity?limit=${RECENT}`),
  });

  const layaState = laya.data?.state;
  const failed = activity.data?.events.filter((e) => e.outcome !== "ok").length ?? 0;
  const seen = activity.data?.events.length ?? 0;
  return {
    "output-styles": styles.isError
      ? UNAVAILABLE
      : styles.data
        ? { text: count(styles.data.builtins.length + styles.data.styles.length, "style") }
        : CHECKING,
    workflows: flows
      ? { text: flows.length ? count(flows.length, "workflow") : "None yet" }
      : CHECKING,
    decisions: laya.isError
      ? UNAVAILABLE
      : layaState
        ? layaState === "ready"
          ? { text: "Ready" }
          : layaState === "off"
            ? { text: "Off" }
            : { text: "Loading the model…", tone: "warning" }
        : CHECKING,
    accounts:
      harnesses.isError || connections.isError
        ? UNAVAILABLE
        : harnesses.data && connections.data
          ? engines(
              harnesses.data,
              connections.data.connections.filter((c) => c.state === "active").length,
            )
          : CHECKING,
    snapshots: snaps ? { text: snaps.length ? `${snaps.length} shared` : "None yet" } : CHECKING,
    activity: activity.isError
      ? UNAVAILABLE
      : activity.data
        ? seen === 0
          ? { text: "Nothing yet" }
          : failed > 0
            ? { text: `${failed} of the last ${seen} failed`, tone: "danger" }
            : { text: `Last ${seen} all worked` }
        : CHECKING,
  };
}

const Summary = ({ status }: { status: Status }) =>
  status.tone ? (
    <Badge tone={status.tone}>{status.text}</Badge>
  ) : (
    <span className="text-muted-foreground tabular-nums">{status.text}</span>
  );

const SECTIONS = studioTabs.filter(
  (t) =>
    t.slug !== "overview" &&
    t.slug !== "attention" &&
    t.slug !== "plugins" &&
    t.slug !== "computer",
);

/** Each section in one line: what it is for, and its state now. The state is derived; there is nothing to fill in. */
export function Overview({ onError }: { onError: (m: string) => void }) {
  const status = useStatus(onError);
  return (
    <ul aria-label="Studio sections" className={list}>
      {SECTIONS.map((s) => (
        <li key={s.slug}>
          <Link
            to="/studio/$tab"
            params={{ tab: s.slug }}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span className="min-w-0 flex-1 basis-64">
              <span className="block font-medium">{s.label}</span>
              <span className="block text-pretty text-muted-foreground">{s.blurb}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Summary status={status[s.slug as StudioTab] ?? CHECKING} />
              <CaretRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
