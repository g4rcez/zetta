# Light engine runs: the same lessons reading, with and without the host's plugins and tools

Run: 2026-11-18 02:46 UTC. Result: **FAILED** (2 passed, 1 failed, 0 skipped).
Script: `scripts/e2e/light-run-compare.ts`. Needs: the Claude CLI installed and signed in.

| Check                                                     | Result | Detail                                     |
| --------------------------------------------------------- | ------ | ------------------------------------------ |
| both sides answer every time                              | pass   | 3 runs each                                |
| the light side uses fewer tokens                          | pass   | plain 45901 tokens, light 4943 (89% fewer) |
| the candidates are mostly the same (at least 80% overlap) | fail   | overlap is 75%                             |

## Notes

- Switch the default of the setting lightRuns to on only when every check here is green on this machine and on a second one.
