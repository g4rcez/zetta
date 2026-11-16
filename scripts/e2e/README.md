# End-to-end runs

Scripts that run a part of Zetta for real (a real browser, a real model, real images, the real GitHub) and write what happened to
`docs/verification/e2e/<area>.md`. They are not part of CI or of `bun run verify`: they need things a CI runner does not have, and some cost
a few small model calls. Run one when you change its area, then update `packages/core/src/maturity.ts` for what came back green.

| Script                     | What it proves                                                                                                                                                                                                                                                                                                  | Needs                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `engines.ts`               | Each installed engine CLI answers one real turn through `runCli`                                                                                                                                                                                                                                                | the CLIs, signed in                                              |
| `playground-containers.ts` | The playground's container runner with the real Bun, Python and bash images                                                                                                                                                                                                                                     | Podman or Docker, network for the first pull                     |
| `skills-market.ts`         | The marketplace's read side against the real GitHub                                                                                                                                                                                                                                                             | network (60 unauthenticated calls an hour)                       |
| `memory-learning.ts`       | A correction becomes a skill with a real model; no skill for a one-off; no secret kept                                                                                                                                                                                                                          | the Claude CLI, embedded Postgres runtime                        |
| `app-frame.ts`             | An app page in its sandboxed frame in Chromium: tools, the approval bar, decline, origin, cookies, network                                                                                                                                                                                                      | the demo stack, Chromium                                         |
| `project-pages.ts`         | The project page in Chromium, and the brief draft with a real model                                                                                                                                                                                                                                             | the demo stack, Chromium, the Claude CLI                         |
| `conversation-memory.ts`   | The summary of a long chat keeps the facts, ignores hidden instructions, and never sends a chat that holds a key                                                                                                                                                                                                | the Claude CLI, embedded Postgres runtime                        |
| `voice.ts`                 | The real Whisper model reads a spoken English clip and a Portuguese one (told the language); with `ZETTA_E2E_TRANSCRIBE_KEY` set, a real provider (OpenAI, or an OpenAI-compatible `ZETTA_E2E_TRANSCRIBE_URL`) reads the English clip                                                                           | macOS (`say`, `afconvert`), network for the first model download |
| `ui-new-features.ts`       | Beta marks, thumbs and their note, Quality tab (numbers, saved tests, history and restore), the chat memory form, the speech-to-text settings (provider, sealed key, test) against a local fake provider, the microphone with a fake input device, a workflow with a loop and an approval that stops as waiting | the demo stack, Chromium                                         |

The browser scripts use the isolated stack of the demo kit:

```sh
ZETTA_DEMO_ALLOW_PRIVATE=1 docs/demo/computer/stack.sh up   # its own database, API and web app on other ports, fake data, a stand-in engine; ALLOW_PRIVATE is for ui-new-features.ts (its fake provider is on this machine)
bun scripts/e2e/app-frame.ts
bun scripts/e2e/project-pages.ts
bun scripts/e2e/ui-new-features.ts
docs/demo/computer/stack.sh down
```

`playwright-core` comes from the tooling already in `node_modules` (see `docs/demo/computer/lib.ts`); Chromium from `npx playwright install chromium`
or any `ms-playwright` cache. On a Mac with Podman, pass `ZETTA_DEMO_ENGINE=/opt/podman/bin/podman` to the stack script.

A script writes `skip` for what this machine cannot do (a CLI that is not installed, a rate limit) and never a `pass` it did not earn.
Reports hold no absolute paths, home folder or e-mail address: `report.ts` cleans them before writing.
