# Voice call: a spoken sentence through the real socket

Run: 2026-11-23 02:47 UTC. Result: **GREEN** (6 passed, 0 failed, 0 skipped).
Script: `scripts/e2e/voice-call.ts`. Needs: macOS, the embedded Postgres runtime, network for the first Whisper download.

| Check                                                                | Result | Detail                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whisper reads the spoken sentence through the socket                 | pass   | 100% of the words. Said: "Please remind me to send the invoice to the client on Friday morning." Heard: "Please remind me to send the invoice to the client on Friday morning." (clip 3.8 s) |
| The states go listening, thinking, speaking, listening               | pass   | listening > thinking > speaking > listening > ended                                                                                                                                          |
| The reply comes back as text for the device to speak, never as audio | pass   | Sure, I will remind you on Friday morning. / The invoice goes to the client.                                                                                                                 |
| Time from the end of speech to the first sentence                    | pass   | 1736 ms to the first say (1646 ms to the transcript: the end-of-turn silence, then the recognizer already had the words)                                                                     |
| The chat holds what was said and the bot's reply, marked as a call   | pass   | user message "Please remind me to send the invoice to the client on Friday morning.", reply "Sure, I will remind you on Friday morning. The invoice goes to the client.", spokenChars 73     |
| The call row ends as hangup and the audit trail has both events      | pass   | status ended, reason hangup, 7 s, audit ended:hangup + started                                                                                                                               |

## Notes

- The sentence is the machine's own synthetic voice, so accents, noise and a real microphone are not covered, and the browser's microphone and speaker code was not run here (the page was not built in this step).
- The bot's engine is a scripted stand-in for the Claude CLI; the chat service, the turn pipeline and the late-message path are the real ones. Barge-in and stop are covered by the integration tests with a fake recognizer and voice, not by this run.
- The `browser` voice was used so that no key is needed. A provider voice (audio frames back) was tested with a fake provider only.
