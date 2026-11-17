import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

import { errorMessage } from "../chat/chat-client";
import { pluginsApi } from "../plugins/plugins-api";
import { agendaApi } from "./agenda-api";
import { googleStatus } from "./agenda-sync";

/** Whether the user added a calendar link (ICS). Its own key: the plugin list is not part of the Agenda reads. */
const linkInstalled = queryOptions({
  queryKey: ["agenda-link-installed"],
  staleTime: 60_000,
  queryFn: async () => (await pluginsApi.installed().catch(() => [])).some((p) => p.id === "ics"),
});

export type CalendarSource = "loading" | "none" | "connected";
/** Is any calendar feeding the Agenda: Google with a Calendar permission, or a calendar link. */
export function useCalendarSource(): CalendarSource {
  const google = useQuery(googleStatus);
  const link = useQuery(linkInstalled);
  if (google.isPending || link.isPending) return "loading";
  const g = google.data?.google;
  return link.data || g === "ok" || g === "read-only" ? "connected" : "none";
}

const DAY = 86_400_000;
const NEXT_DAYS = 60;
const SHOWN = 3;
type Next = { id: string; title: string; startAt: string; allDay: boolean; from: string };
type Outcome =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "events"; next: Next[] }
  | { kind: "empty"; note: string }
  | { kind: "problem"; text: string };

const LINK =
  "inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
const LINK_PRIMARY =
  "inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Shown on the Agenda when no calendar feeds it: what Agenda does with one, the two ways to connect it, and a Test that reads the next
 * events through the Agenda's own read and says plainly what it found or what is wrong. Once a source is connected the card goes away,
 * unless a Test result is on screen: then it stays until the person closes it.
 */
export function AgendaConnect({
  source,
  syncEnabled,
}: {
  source: CalendarSource;
  syncEnabled: boolean | undefined;
}) {
  const qc = useQueryClient();
  const tf = useTimeFormat();
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  async function test() {
    setOutcome({ kind: "testing" });
    try {
      // Look at the connections again: the person may have just connected one on another page.
      const [google, link] = await Promise.all([
        qc.fetchQuery({ ...googleStatus, staleTime: 0 }),
        qc.fetchQuery({ ...linkInstalled, staleTime: 0 }),
      ]);
      const googleOn = google.google === "ok" || google.google === "read-only";
      if (!googleOn && !link) {
        setOutcome({
          kind: "problem",
          text:
            google.google === "no-calendar"
              ? "Google is connected, but without a Calendar permission. Open the Google plugin, change the account's permissions and tick a Calendar one."
              : "Nothing is connected yet. Connect Google Calendar or add a calendar link, then press Test again.",
        });
        return;
      }
      if (googleOn && syncEnabled) {
        const synced = await agendaApi.syncNow();
        if (!synced.result.ok && synced.result.error) {
          setOutcome({ kind: "problem", text: synced.result.error });
          return;
        }
      }
      const now = new Date();
      const read = await agendaApi.list(now, new Date(now.getTime() + NEXT_DAYS * DAY));
      const broken = read.external.find((c) => c.error);
      if (broken) {
        setOutcome({ kind: "problem", text: `${broken.calendar}: ${broken.error}` });
        return;
      }
      const next: Next[] = [
        ...read.items
          .filter((i) => i.kind === "event" && i.status === "open")
          .map((i) => ({
            id: i.id,
            title: i.title,
            startAt: i.startAt,
            allDay: i.allDay,
            from: i.source === "google" ? "Google Calendar" : "Agenda",
          })),
        ...read.external.flatMap((c) =>
          c.events.map((e) => ({
            id: e.id,
            title: e.title,
            startAt: e.startAt,
            allDay: e.allDay,
            from: c.calendar,
          })),
        ),
      ]
        .filter((e) => new Date(e.startAt).getTime() >= now.getTime() - (e.allDay ? DAY : 0))
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .slice(0, SHOWN);
      if (next.length) setOutcome({ kind: "events", next });
      else
        setOutcome({
          kind: "empty",
          note:
            googleOn && !syncEnabled
              ? "Google is connected, but its events are not coming in yet. Turn on “Keep in sync with Google Calendar” above."
              : `The connection works, and there are no events in the next ${NEXT_DAYS} days.`,
        });
    } catch (e) {
      setOutcome({ kind: "problem", text: errorMessage(e) });
    }
  }

  if (source === "loading") return null;
  if (source === "connected" && outcome.kind === "idle") return null;
  return (
    <section
      aria-labelledby="agenda-connect-title"
      className="flex shrink-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4"
    >
      {source === "none" && (
        <>
          <div className="space-y-1">
            <h2 id="agenda-connect-title" className="text-base font-semibold">
              Connect a calendar to fill your Agenda
            </h2>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">
              Agenda keeps your tasks, reminders and events in one place, and your bots add to it
              from conversations. Connect a calendar and its events show up here too. With Google
              Calendar, what you add here can also go back to Google.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/plugins/$pluginId" params={{ pluginId: "google" }} className={LINK_PRIMARY}>
              Connect Google Calendar
            </Link>
            <Link to="/plugins/$pluginId" params={{ pluginId: "ics" }} className={LINK}>
              Add a calendar link (ICS)
            </Link>
            <Button
              variant="ghost"
              onClick={() => void test()}
              loading={outcome.kind === "testing"}
            >
              Test
            </Button>
          </div>
          <p className="max-w-prose text-xs text-pretty text-muted-foreground">
            Google Calendar needs your own Google Cloud OAuth client; the plugin page walks you
            through it. A calendar link only reads: paste the private ICS address from your
            calendar&apos;s settings and nothing is ever changed.
          </p>
        </>
      )}
      {source === "connected" && (
        <h2 id="agenda-connect-title" className="text-base font-semibold">
          Calendar connection test
        </h2>
      )}
      <div aria-live="polite">
        {outcome.kind === "events" && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Connected. Your next events:</p>
            <ul className="space-y-1 text-sm">
              {outcome.next.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular-nums text-muted-foreground">
                    {e.allDay ? e.startAt.slice(0, 10) : formatDateTime(e.startAt, tf)}
                  </span>
                  <span>{e.title}</span>
                  <span className="text-xs text-muted-foreground">{e.from}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {outcome.kind === "empty" && <p className="text-sm">{outcome.note}</p>}
        {outcome.kind === "problem" && (
          <p role="alert" className="text-sm text-destructive">
            {outcome.text}
          </p>
        )}
      </div>
      {source === "connected" && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setOutcome({ kind: "idle" })}>
            Close
          </Button>
        </div>
      )}
    </section>
  );
}
