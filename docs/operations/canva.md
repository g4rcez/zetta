# Canva plugin

- **Sign-in:** OAuth with your own Canva integration (client id + secret).
- **Tools:** designs, create_design, export (pdf/png/jpg).
- **Code:** `apps/server/src/modules/integrations/plugins/canva.ts`, tests in `new-plugins.test.ts` (faked API).

Create an integration at canva.com/developers with `<your Zetta address>/api/plugins/canva/callback` as redirect URL. The flow is authorization code + PKCE (shared helper `integrations/plugins/oauth2.ts`); tokens are sealed and refreshed. Exports are saved under outputs/canva/ in your code folder.
