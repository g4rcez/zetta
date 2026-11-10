# Obsidian plugin

- **Sign-in:** The vault folder path (local installs only).
- **Tools:** search, read, list, write (no overwrite unless asked), append (today's daily note by default), backlinks.
- **Code:** `apps/server/src/modules/integrations/plugins/obsidian.ts`, tests in `new-plugins.test.ts` (faked API).

Works only when Zetta runs on the computer that has the vault. Every path stays inside the vault: `..`, absolute paths and symlinks that leave it are refused.

Not verified against the live service: the endpoints follow the vendor's public API reference; check them with a real account before relying on them.
