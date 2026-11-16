# New screens in a real browser

Run: 2026-11-16 00:11 UTC. Result: **GREEN** (11 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/ui-new-features.ts`. Needs: the demo stack and Playwright's Chromium.

| Check                                                                                                  | Result | Detail                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Beta marks sit next to Projects, Skills and Apps in the sidebar                                        | pass   | Projects Beta \| Skills Beta \| Apps Beta                                                                                                      |
| A thumb up on a reply is saved                                                                         | pass   | rating up stored                                                                                                                               |
| A thumb down opens a note box, and the note is saved with it                                           | pass   | rating down with its note stored                                                                                                               |
| Performance counts the thumb down and the answer                                                       | pass   | Bad answers 2 (earlier runs of this script add to it)                                                                                          |
| A saved test is added and listed                                                                       | pass   | saved test listed on the page and by the API                                                                                                   |
| A change to the bot shows in History and can be brought back                                           | pass   | restored as version 7                                                                                                                          |
| The microphone records, sends 16 kHz samples with the browser language, and puts the words in the box  | pass   | 107520 bytes (3.4 s), language en-US                                                                                                           |
| The chat memory form checks a typed value, saves it, and History lists it                              | pass   | typed 33,000 / bot / 4,000 / 9,000 / 4 saved, listed in History, and reset to the defaults                                                     |
| The speech-to-text settings: a provider, a sealed key that is never shown again, and a test that works | pass   | provider, address, model and language saved; the key sealed, cleared from the field and never returned; Test reached the provider with the key |
| The microphone's route uses the chosen provider with the browser's language, and a removed key says so | pass   | the route followed the provider and the browser's language (fr); with no key it said so, in a fixed sentence                                   |
| A workflow with a loop and an approval shows on the canvas and stops at a waiting run                  | pass   | loop, approval and wait steps shown; a run stopped at the approval (waiting), its card is chief_action pending; cancel 200                     |

## Notes

- Speech to text is faked in this script (the words come back from a stub); the real model is checked in voice.md.
- The reply the thumbs rate was written into the demo database by this script: no model answered it.
