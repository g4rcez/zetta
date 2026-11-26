# ElevenLabs plugin

- **Sign-in:** API key.
- **Tools:** voices, speak (mp3 up to 5,000 characters), usage.
- **Code:** `apps/server/src/modules/integrations/plugins/elevenlabs.ts`, tests in `new-plugins.test.ts` (faked API).

Audio is saved in your code folder under outputs/elevenlabs/ (bots with code access can use or move it). Calls go only to https://api.elevenlabs.io/v1.
