# Memory learning: a correction becomes a skill, with a real model

Run: 2026-11-15 22:24 UTC. Result: **GREEN** (3 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/memory-learning.ts`. Needs: the Claude CLI signed in; the embedded Postgres runtime (`bun run db:runtime`).

| Check                                                                                  | Result | Detail                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| a clear correction is queued and the real model turns it into a skill of the bot's own | pass   | review took 6 s; skill "dashboard-export-use-csv-not-table": When exporting numbers or records from a dashboard or report page, use its CSV e |
| a one-off request with no lesson is not kept as a skill                                | pass   |                                                                                                                                               |
| a lesson that contains a secret is never saved with the secret in it                   | pass   | kept without the key: "staging-deploy-flow"                                                                                                   |

## Notes

- The model judges each case itself, so a different run can word the skill differently; the checks only look at what must hold (queued, attached, learned, mentions the lesson, no one-off, no secret).
