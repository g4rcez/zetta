# Apps: a page in its frame, in a real browser

Run: 2026-11-15 22:27 UTC. Result: **GREEN** (6 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/app-frame.ts`. Needs: the isolated demo stack (`docs/demo/computer/stack.sh up`) and a Chromium.

| Check                                                                                  | Result | Detail                                                         |
| -------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| a playground with a backend and a page is published as an app                          | pass   | slug e2e-app-mwieo71g, 2 tools                                 |
| the frame is sandboxed with scripts only: no same-origin, no popups, no top navigation | pass   | allow-forms allow-scripts                                      |
| a query runs through the host and its answer reaches the page                          | pass   |                                                                |
| a change shows an approval bar outside the frame, and Allow lets it through            | pass   |                                                                |
| Decline reaches the page as a rejection with code DECLINED                             | pass   |                                                                |
| the frame has an opaque origin, no cookies and no network                              | pass   | origin "null", cookies blocked (SecurityError), network closed |

## Notes

- Chromium through playwright-core, against the isolated stack with its stand-in engine. Not covered: Firefox and Safari, a bot calling the app, and the app tool running in the container runner.
