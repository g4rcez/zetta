# Apple apps plugin

- **Sign-in:** None (local installs on macOS only).
- **Tools:** notes_search, notes_create, reminders_list, reminders_add, calendar_events, contacts_find, shortcuts_run.
- **Code:** `apps/server/src/modules/integrations/plugins/apple.ts`, tests in `new-plugins.test.ts` (faked API).

Runs osascript and shortcuts on the Mac Zetta runs on. Values are passed as arguments, never inside the script. macOS asks once per app (System Settings > Privacy & Security > Automation). Nothing is sent or deleted.

Not verified against the live service: the endpoints follow the vendor's public API reference; check them with a real account before relying on them.
