# Calendar link (ICS) plugin

- **Sign-in:** none. You paste a calendar's private ICS address (sealed field `url`) and an optional name.
- **Tools:** `ics_list_events` (read).
- **Agenda:** the Agenda page shows the events read-only (a dashed pill marked "Link"); clicking one opens a details view with no edit.
- **Code:** `apps/server/src/modules/integrations/plugins/ics.ts` (fetch, cache) and `ics-parse.ts` (reader), the Agenda part in `apps/server/src/modules/agenda/ics-view.ts`, tests next to them.

## Setup

- Google Calendar: Settings, pick the calendar, Integrate calendar, copy the Secret address in iCal format.
- Outlook: Settings > Calendar > Shared calendars > Publish a calendar, copy the ICS link.
- iCloud: share the calendar as a public calendar and copy its link (`webcal://` works).

Open Plugins > Calendar link (ICS) and paste the address. Anybody who has the address can read the calendar, so it is sealed like any plugin secret and never shown again, to you or to a bot. If you reset the address in your calendar app, paste the new one.

## What it reads

VEVENTs with title, start and end (timed, all-day, UTC, floating and TZID times, including Windows zone names), place and description. Recurring events are expanded for the window asked: daily, weekly, monthly and yearly rules with interval, count, until, BYDAY (also `2MO`, `-1FR`), BYMONTHDAY, BYMONTH and BYSETPOS, plus EXDATE, RDATE and moved or cancelled single occurrences. Not read: rules finer than a day, BYHOUR and similar, VTODO. Cancelled events are left out.

The reader is our own (about 500 lines, no dependency): the feed is read-only and bounded, so a library such as `ical.js` was not worth the extra package. It is covered by tests for the cases above, including a clock change.

## Safety

- https only (`webcal://` is read as https). Addresses with a user name or password are refused. Private, loopback and local addresses are refused, and every redirect (at most three) is checked again and must be https.
- At most 5 MB, 15 seconds. The answer is kept 5 minutes in memory, so the Agenda page refreshing every minute does not hit your calendar server each time.
- Event text was written by other people. Bots get it framed as untrusted data; the Agenda page shows it as plain text.
- The address never appears in a result, error, status or log line.
- Private network feeds (a calendar on your own LAN) are not supported: there is no operator switch for it in this plugin.

## Limits of this version

- One link per person. Use a calendar that combines the others, or Google Calendar, for more.
- The events are read when the Agenda is read; they are not copied into the Agenda, so they have no reminders and cannot be completed, moved or sent to Google. Copying them in would need a place to keep them (a `source` value and an external id on `agenda_item`), which is a schema change.

Not verified against the live service: tested with sample feeds only, no real Google, Outlook or iCloud address was used.
