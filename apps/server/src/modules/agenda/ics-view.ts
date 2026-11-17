import { createHash } from "node:crypto";

import type { ActiveActor } from "../identity/access";
import { readIcsEvents } from "../integrations/plugins/ics";
import type { IcsEvent } from "../integrations/plugins/ics-parse";
import { PluginError, type PluginContext } from "../integrations/plugins/registry";

/**
 * Events of the user's pasted calendar link (the "ics" plugin), shown in the Agenda next to its own items. They are read at the moment the
 * Agenda is read and never stored: there is no table for them, so they cannot be edited, completed or synced back, and the page marks them
 * read-only. The feed answer is cached for a few minutes by the plugin, so a page that refreshes every minute does not hit the calendar.
 * Text in a feed was written by other people: the web app renders it as plain text, and bots reach it only through the plugin's tools.
 */
export type ExternalAgendaEvent = {
  /** Stable for the same event and start, so a list keeps its keys between reads. Not an Agenda item id: it cannot be opened or changed. */
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string;
  description: string;
  recurring: boolean;
};
export type ExternalAgenda = {
  source: "ics";
  /** The name the user gave the calendar, or the one the feed has. */
  calendar: string;
  events: ExternalAgendaEvent[];
  /** Set when the feed could not be read: what went wrong in plain words and what to do. The Agenda still shows everything else. */
  error?: string;
};
export type AgendaIcsPlugins = {
  contextFor: (a: ActiveActor, id: string) => Promise<PluginContext>;
};

const shape = (e: IcsEvent): ExternalAgendaEvent => ({
  id: `ics-${createHash("sha256").update(`${e.uid}|${e.start.toISOString()}`).digest("hex").slice(0, 24)}`,
  title: e.title.slice(0, 200),
  startAt: e.start.toISOString(),
  endAt: e.end ? e.end.toISOString() : null,
  allDay: e.allDay,
  location: e.location.slice(0, 200),
  description: e.description.slice(0, 4000),
  recurring: e.recurring,
});

export function createIcsAgendaView(plugins: AgendaIcsPlugins | undefined) {
  return {
    /** The linked calendars' events inside [from, to), or an empty list when the user has not added a calendar link. */
    async external(a: ActiveActor, from: Date, to: Date): Promise<ExternalAgenda[]> {
      if (!plugins) return [];
      let ctx: PluginContext;
      try {
        ctx = await plugins.contextFor(a, "ics");
      } catch {
        return []; // not installed: nothing to show
      }
      const calendar = (ctx.config.name ?? "").trim().slice(0, 80);
      try {
        const r = await readIcsEvents(ctx, { from, to });
        return [
          {
            source: "ics",
            calendar: calendar || r.name.slice(0, 80) || "Calendar link",
            events: r.events.map(shape),
          },
        ];
      } catch (e) {
        const safe =
          e instanceof PluginError ? e.safe : "The calendar link could not be read right now.";
        const fix = e instanceof PluginError && e.fix ? ` ${e.fix}` : "";
        return [
          {
            source: "ics",
            calendar: calendar || "Calendar link",
            events: [],
            error: `${safe}${fix}`,
          },
        ];
      }
    },
  };
}
export type IcsAgendaView = ReturnType<typeof createIcsAgendaView>;
