# Projects: the page in a real browser, and the brief draft with a real model

Run: 2026-11-15 22:28 UTC. Result: **GREEN** (6 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/project-pages.ts`. Needs: the isolated demo stack, a Chromium, and the Claude CLI.

| Check                                                                   | Result | Detail                                                                |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| a project is created with a bot on it                                   | pass   | worker Operator                                                       |
| the page shows the name, a health sentence and a progress count         | pass   | 0 of 1 tasks done                                                     |
| the task the manager asked for is listed under the bot that does it     | pass   |                                                                       |
| the manager can ask from the page: the box and the Ask button are there | pass   |                                                                       |
| one sentence becomes a four-part brief a person can correct             | pass   | 5 s; outcome: A landing page and one email promoting the spring sale. |
| a sentence that holds a secret is not sent to the model                 | pass   |                                                                       |

## Notes

- Not covered: the stalled-work scan run by the server's own ticker over days, a member (not the owner) looking at the page, and the page on a phone.
