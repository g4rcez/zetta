# Fluid chat: messages sent while a bot works, with a real model

Run: 2026-11-19 15:29 UTC. Result: **GREEN** (3 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/fluid-chat.ts`. Needs: the Claude CLI installed and signed in, the embedded Postgres runtime.

| Check                                                                      | Result | Detail                                                                                                                                          |
| -------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| five messages in a row get one answer that reflects all five               | pass   | one reply after 9 s: APPLE, MANGO, CHERRY                                                                                                       |
| a correction sent during a long command is read when the command ends      | pass   | correction sent 8 s in, turn took 22 s, 4 steps, out.txt = RIGHT; reply: I wrote **RIGHT** to out.txt. The sleep finished first and printed `sl |
| Stop with an unread message ends the reply and nothing answers the message | pass   | reply cancelled; the message stays, unread, with 3 messages in the chat                                                                         |
