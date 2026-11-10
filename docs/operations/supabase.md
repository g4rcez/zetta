# Supabase plugin

- **Sign-in:** Personal access token.
- **Tools:** projects, tables, sql.
- **Code:** `apps/server/src/modules/integrations/plugins/supabase.ts`, tests in `new-plugins.test.ts` (faked API).

SQL is read-only by default: one SELECT/WITH/EXPLAIN/SHOW statement, no stacked statements. Turn on "SQL writes" in the plugin to allow changes. Calls go only to https://api.supabase.com/v1.

Not verified against the live service: the endpoints follow the vendor's public API reference; check them with a real account before relying on them.
