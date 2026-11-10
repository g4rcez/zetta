# Vercel plugin

- **Sign-in:** Access token (+ team id for a team).
- **Tools:** projects, deployments, build_logs, domains, env_names (names only, never values), redeploy.
- **Code:** `apps/server/src/modules/integrations/plugins/vercel.ts`, tests in `new-plugins.test.ts` (faked API).

Redeploy reuses an existing deployment; it targets production only when asked. Calls go only to https://api.vercel.com.

Not verified against the live service: the endpoints follow the vendor's public API reference; check them with a real account before relying on them.
