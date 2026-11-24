# Server settings: the Studio page, its sources, filters and confirmation in a real browser

Run: 2026-11-23 20:17 UTC. Result: **GREEN** (12 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/server-settings.ts`. Needs: the embedded Postgres runtime, Helium, Node 24.

| Check                                                                                                   | Result | Detail                                                   |
| ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| first-run account is created through the real onboarding form                                           | pass   |                                                          |
| the tab is in the Studio side nav for the administrator and the page groups the keys with their sources | pass   | 7 groups                                                 |
| a value imported from the environment says so                                                           | pass   |                                                          |
| a security policy carries its warning                                                                   | pass   |                                                          |
| a switch saved off persists after a reload with source 'installation'                                   | pass   |                                                          |
| a number saved persists after a reload with source 'installation'                                       | pass   |                                                          |
| reset to default puts a switch back and the page says 'The default'                                     | pass   |                                                          |
| a security policy asks first; Cancel changes nothing; confirming saves it                               | pass   |                                                          |
| the server's validation error is shown next to the field                                                | pass   | "Bot runs at once, in total" must be between 1 and 1000. |
| the group filter writes the address and survives a reload                                               | pass   |                                                          |
| 'Only changed' writes the address and survives a reload; defaults are left out                          | pass   |                                                          |
| the search text is in the address and filters the page                                                  | pass   |                                                          |

## Notes

- screenshots are in <tmp>
