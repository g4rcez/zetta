# Studio places: Decisions, Voice, the WhatsApp and Bot e-mail address plugin pages and Server settings, for an administrator and a member

Run: 2026-11-23 20:15 UTC. Result: **GREEN** (10 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/studio-places.ts`. Needs: the embedded Postgres runtime, Helium, Node 24.

| Check                                                                                 | Result | Detail                                                          |
| ------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| first-run account is created through the real onboarding form                         | pass   |                                                                 |
| Studio > Decisions shows only Laya status, its switch and the sample form             | pass   |                                                                 |
| the Studio side nav lists Voice right after Phone numbers                             | pass   |                                                                 |
| Studio > Voice loads both cards; a speech-to-text setting saves and survives a reload | pass   |                                                                 |
| the WhatsApp plugin page shows Server for everyone, and the address saves             | pass   |                                                                 |
| the Bot e-mail address plugin page shows its server setup                             | pass   |                                                                 |
| the plugin list leads to both pages                                                   | pass   |                                                                 |
| Server settings shows the Updates card and its switch saves                           | pass   |                                                                 |
| a second account is created through an invitation                                     | pass   |                                                                 |
| a member sees none of the administrator sections and no write is sent                 | pass   | voice, WhatsApp, Bot e-mail address and Server settings checked |

## Notes

- screenshots are in <tmp>
