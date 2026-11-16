# Engines: one real turn each

Run: 2026-11-15 22:21 UTC. Result: **PARTIAL** (3 passed, 0 failed, 5 skipped).
Script: `scripts/e2e/engines.ts`. Needs: each engine CLI installed and signed in.

| Check       | Result | Detail                                                                                                                                                                                                                                                                                                       |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| claude-code | pass   | answered in 2.8 s: OK                                                                                                                                                                                                                                                                                        |
| codex       | skip   | installed, but the CLI also fails when run by hand on this machine (failed): hook: UserPromptSubmit Completed / ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.","code":"model_not_ |
| opencode    | skip   | installed, but the CLI also fails when run by hand on this machine (failed): at service.ensure (definition) (/$bunfs/root/chunk-cj4ses6r.js:3:5523) / at cli.server-connection.resolve (/$bunfs/root/chunk-xtvk0c5y.js:2:1139) / at cli.server-connection.resolve (definition) (/$bunfs/root/chu             |
| pi          | skip   | installed, but the CLI also fails when run by hand on this machine (failed): OAuth refresh failed for openai: OpenAI OAuth token request failed (400): { / "error": "invalid_grant" / }                                                                                                                      |
| omp         | pass   | answered in 5.0 s: OK                                                                                                                                                                                                                                                                                        |
| cursor      | skip   | `cursor-agent` is not installed on this machine                                                                                                                                                                                                                                                              |
| hermes      | pass   | answered in 5.5 s: OK                                                                                                                                                                                                                                                                                        |
| deepseek    | skip   | `dsh` is not installed on this machine                                                                                                                                                                                                                                                                       |

## Notes

- An engine only counts as verified here when it answered a real turn through `runCli`. Isolation (Docker mode), tools and streaming are not covered by this script.
