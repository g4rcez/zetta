# Voice: a spoken clip read back by the real Whisper model

Run: 2026-11-16 00:13 UTC. Result: **PARTIAL** (3 passed, 0 failed, 1 skipped).
Script: `scripts/e2e/voice.ts`. Needs: macOS, network for the first model download.

| Check                                           | Result | Detail                                                                                                                                                                                           |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The clip is 16 kHz mono samples                 | pass   | 3.8 s                                                                                                                                                                                            |
| Whisper reads the clip back                     | pass   | 100% of the words, 2.0 s (including model load): "Please remind me to send the invoice to the client on Friday morning."                                                                         |
| Whisper reads Portuguese when told the language | pass   | 53% of the words with a synthetic Brazilian voice (approximate: the small model is not exact in Portuguese): "Por favor, me lembra da enviar a favor da parra o cliente no sexo de feridomanda." |
| A real provider reads the clip                  | skip   | no ZETTA_E2E_TRANSCRIBE_KEY set: the provider path was tested against a local fake only                                                                                                          |

## Notes

- Portuguese came back about half right on synthetic voices with the small model: usable to get the idea of a voice note, not a transcript to rely on. A larger model can be set with ZETTA_TRANSCRIBE_MODEL (not tried here).
- The clip is synthetic speech from the machine's own voice, so accents, noise and a real microphone are not covered.
- The browser microphone path (recording and resampling) is checked in a real browser with a fake input device, not here.
