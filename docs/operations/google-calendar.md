# Google Calendar (part of the Google plugin)

- **Sign-in:** Google's OAuth 2.0 with your own Google Cloud OAuth client (Desktop app or Web application). Several Google accounts can be connected; every tool takes an optional `account` (the email).
- **Tools:** `calendar_list_calendars`, `calendar_list_events`, `calendar_free_busy` (reads); `calendar_create_event`, `calendar_update_event`, `calendar_delete_event` (writes).
- **Code:** `apps/server/src/modules/integrations/plugins/google/calendar.ts`, tests in `calendar.test.ts` (fake Google). The Agenda sync is separate (`apps/server/src/modules/agenda/google-sync.ts`).

## Setup

Zetta has no shared Google client: you need your own.

1. In Google Cloud Console create a project, then in APIs & Services > Library enable the Google Calendar API.
2. Configure the OAuth consent screen and add your own Google accounts as test users.
3. Create an OAuth client ID of type Desktop app (works from any address) or Web application (needs a public https redirect address).
4. Open Plugins > Google, paste the client ID and secret, tick the permissions you want and sign in. The page walks through each step.

## Permissions and what each tool needs

| Tool                                                                      | Google permission (any one)                                                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `calendar_list_events`                                                    | `calendar.events.readonly`, `calendar.events` or `calendar.readonly`       |
| `calendar_create_event`, `calendar_update_event`, `calendar_delete_event` | `calendar.events` ("Calendar: create and edit events")                     |
| `calendar_list_calendars`, `calendar_free_busy`                           | `calendar.readonly` ("Calendar: see your calendars and when you are busy") |

The events permissions do not cover the calendar list or free/busy (checked against Google's API reference), so those two need `calendar.readonly`. An account connected without the permission a tool needs gets: "Reconnect Google to allow this", with the steps (Plugins > Google > Change permissions on that account, tick the permission, sign in again). Zetta checks the permissions Google actually granted before calling, so a missing one never shows up as a raw 403.

Other calendars: `calendar_list_calendars` returns calendar ids, and `calendar_list_events`, `calendar_create_event`, `calendar_update_event`, `calendar_delete_event` take a `calendar` argument (default `primary`). Reading other people's shared calendars works as far as Google lets that account see them.

## What asks first

- `calendar_update_event` and `calendar_delete_event` always stop with an Approve card that names the event (read just before the card is made), the calendar and the account, and shows the change.
- `calendar_create_event` creates at once when it has no guests. With `attendees` it stops with a card that lists the guests and says whether anybody is e-mailed.
- Guests: `sendUpdates` is `none` unless the call asks for `all`. With `all` the card says "Google will e-mail ... to a@..., b@..." with every address. Without guests, `all` is downgraded to `none`. On update, `attendees` replaces the whole guest list (Google's behaviour for arrays), so the card shows the new list.
- The call is signed inside the request id with your OAuth client secret and user, so a card cannot be edited or answered by someone else, and it expires after 30 minutes. Declining changes nothing.

## Not changed

The Agenda sync still reads and writes only the primary calendar of each account and sends no invitations. Accounts connected with only `calendar.readonly` are not used by the Agenda sync (it needs an events permission). The scope picker in the Google plugin page lists it as "See your calendars and when you are busy".
