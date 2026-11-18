# Lessons: the daily reading of a bot's chats, with a real model

Run: 2026-11-18 02:45 UTC. Result: **GREEN** (6 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/lessons-batch.ts`. Needs: the Claude CLI installed and signed in.

| Check                                                               | Result | Detail                                         |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| the reading runs with the real engine and finishes                  | pass   | took 7 s; 2 candidates, 2 started              |
| the rule the person said outright is on trial, said and not guessed | pass   | "Answer refund questions in a single line."    |
| the correction made in two chats is on trial                        | pass   | "Put reports in tables, not lists." (repeated) |
| a passing remark said once is not on trial                          | pass   |                                                |
| every quote kept as evidence is really in a message the owner wrote | pass   | 3 quotes, all found                            |
| the reading is recorded, with its window                            | pass   | status done, 2 candidates, 2 started           |
