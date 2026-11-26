# People profiles and the update notice (2026-11-16)

From the client feedback plan (`plans/feedback.md`, items F and M).

## Profile fields

- **Stored** beside the avatar in `user_preference`: `job_title` (80), `department` (80), `about` (1000), `timezone` (64), `contact` (200). Empty means "not written". The limits are one table in `packages/core/src/person-profile.ts`, shared by the database checks, `PATCH /api/profile`, the Chief and the web form.
- **Changed only through `PATCH /api/profile`** (strict: unknown keys are refused). Better Auth's `/update-user` stays closed (`account-write-gate.ts`). Text is trimmed and plain: HTML tags and control characters are refused (`about` keeps line breaks). The time zone must be a real IANA name; empty means the browser's.
- **Read by others** at `GET /api/people` (any active member, `?q=` narrows by name, title or department). It carries name, picture, job title, department, about, contact and `title`. It never carries the email or the time zone. The time zone is on the person's own `GET /api/profile`, where the routine form can read it as the default for a new routine.
- **`title`** is what a list shows under a name: the person's job title, else the title of the company-chart seat they hold (`org_position.title`, the first seat by order), else empty. Team people, team candidates, project candidates, the task assignee (`assigneeTitle`) and the org palette carry it. A seat holder carries the holder's own `jobTitle` (the seat's title is shown on the seat already).
- **Bots read it as data.** A team room's "People of this team" line, the notice a bot gets when a person moves its task, and the `task list` a bot reads add the title next to the name. Each goes through `defuse` (no fences) and is cut to 80 characters. Nothing reads the `about` text or the contact line into a prompt.
- **The Chief**: `zetta:preferences profile{name, jobTitle, department, about, timezone, contact}` is one card that lists each changed line. `get` returns the lines, never the email.
- **Web**: `PersonIdentity` (picture, name, muted title; with `card`, a click opens a small card with department, about and contact), the Profile section of Preferences, and the `/people` page with its search in the address (`?q=`). The About text is a plain `EditorField` on purpose: a person's own words are read by others as they are, so an `@` mention would turn into a bot link.

## Update available

- **Version** is the commit and the commit date, stamped by `install.sh` into the server image (`ZETTA_BUILD_COMMIT`, `ZETTA_BUILD_DATE`). A source checkout asks git at start; anything else is `unknown`. `buildInfo()` is a pure helper.
- **Check**: one plain `GET` of the landing site's `changelog.json` a day, by the process that runs work. No identifier. The newest day in the list is compared with the day of the build: `current | behind | unknown`. The result lives in memory (no table fits without a migration), so a restart checks again.
- **Endpoint**: `GET /api/installation/version`, for a signed-in person. `/api/meta` is untouched and has no version.
- **Switch**: `installation_settings.update_check` (`on | off`), in Studio > Server settings and the installation form the Chief opens; `ZETTA_UPDATE_CHECK=off` of the operator wins.
- **Card**: one `update_available` Catch up card for the administrator, one at a time, closed when the build is current or the check is turned off. Dismissed for a version, it does not come back for that version.
- Operator notes: `docs/operations/upgrade.md`.

## Deviations and limits

- The comparison is by UTC day, because the published list is grouped by day. A build made earlier on the newest day reads as current.
- An `api` process (several servers) checks lazily, when its endpoint is read, at most once a day; only the worker raises the card.
- The org chart canvas and its list rows keep one line per seat: only the seat's own page shows the holder's job title.
