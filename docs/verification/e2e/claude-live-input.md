# Claude Code: a message written while it works

Run: 2026-11-19 15:12 UTC. Result: **PARTIAL** (10 passed, 0 failed, 1 skipped).
Script: `scripts/e2e/claude-live-input.ts`. Needs: the Claude CLI, signed in.

| Check                                                           | Result | Detail                                                                                                                                                                 |
| --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prompt on stdin starts a run                                    | pass   | first tool call after 2.0 s                                                                                                                                            |
| the late message is replayed with our uuid                      | pass   | keys: type, message, session_id, parent_tool_use_id, uuid, timestamp, isReplay; isReplay=true; printed after the tool result (tool result at 14.2 s, replay at 14.3 s) |
| the running command is not cut                                  | pass   | the command printed its last line                                                                                                                                      |
| one answer covers both messages                                 | pass   | result 1: ALPHA BRAVO                                                                                                                                                  |
| a message after an answer gets a new answer in the same process | pass   | CHARLIE                                                                                                                                                                |
| a message written before stdin closes is still answered         | pass   | exit code 0                                                                                                                                                            |
| the process exits when stdin closes                             | pass   | exit code 0                                                                                                                                                            |
| --resume works with the prompt on stdin                         | pass   | ALPHA, BRAVO, CHARLIE, DELTA                                                                                                                                           |
| Zetta's runner hands a message to a working run                 | pass   | reply: ECHO FOXTROT; read receipt received                                                                                                                             |
| a quick question gets its answer while the work goes on         | pass   | answer at 12.0 s, 4 step(s) after it, final reply at 24.8 s: Paris / GOLF                                                                                              |
| the same under `docker run -i`                                  | skip   | not run: needs the bot image with a signed-in CLI                                                                                                                      |

## Notes

- CLI version: 2.1.328 (Claude Code)
- First message replay: at 2.0 s, isReplay=true.
- Late message written 4.0 s into the run; events after the write: command_lifecycle system/task_started system/task_notification user user command_lifecycle system/thinking_tokens system/thinking_tokens assistant assistant command_lifecycle result/success
- Results: #1 subtype=success num_turns=2 input=4 cache_read=50814 output=291 cost=0.007484640000000001; #2 subtype=success num_turns=1 input=2 cache_read=46006 output=8 cost=0.0079967; #3 subtype=success num_turns=1 input=2 cache_read=46245 output=6 cost=0.008472150000000001
- Line types on stdout: system/hook_started x8, system/hook_response x8, command_lifecycle x12, system/init x3, system/commands_changed x1, user (replay) x4, assistant x5, rate_limit_event x1, system/task_started x1, system/task_notification x1, user x1, system/thinking_tokens x2, result/success x3
