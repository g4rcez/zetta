# Voice and documents in chat

## Documents

Attach a PDF, Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`), CSV or TSV file (up to 20 MB) in the message box. Zetta reads its text on the server (PDF first 200 pages; text capped at 256 KB) and the bot gets it as attached content, framed as outside data. A scanned PDF with no text, a password-protected or damaged file, and a file that is not the type its name says are refused with a message. Pictures inside documents and the old `.doc`, `.xls`, `.ppt` formats are not read.

## Voice

- **Microphone button** in the message box: the browser records, the server turns it into words (`POST /api/transcribe`), and the words land in the box for you to read and fix before sending. Needs the browser's microphone permission.
- **Voice notes** sent to a Telegram or WhatsApp route are turned into text before the bot sees them, marked as transcribed automatically and possibly wrong. This needs **ffmpeg** on the server (the Docker image has it; on a Mac, `brew install ffmpeg`). Without it the bot sees "(voice note)".

### Who turns the audio into text

An administrator chooses, in **Studio > Voice > Speech to text** (the choice covers the microphone and voice notes alike):

| Choice                    | Where the audio goes                            | Notes                                                                                                                                  |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **This server** (default) | Nowhere: a Whisper model runs inside the server | Downloads once, about 250 MB, into `~/.cache/zetta/models`. Slow on a small machine; weak in languages other than English.             |
| **OpenAI**                | `api.openai.com`                                | Model `whisper-1` unless you name another (for example `gpt-4o-mini-transcribe`). Needs an API key.                                    |
| **Another provider**      | The address you give                            | Any server that works like OpenAI's `/audio/transcriptions` (Groq, a self-hosted Whisper server). Needs the address and usually a key. |
| **Off**                   | Nowhere                                         | No recording or voice note is turned into text. The microphone button says it is off and voice mode is off.                            |

The page says where recordings will go before you save, and the Save button names the destination. **With a provider, the audio of every recording leaves this machine** for that provider, under its rules.

- **The key** is typed in that page, sealed in the browser, stored encrypted, and never shown again (only "a key is saved"). It is saved as a connection of the administrator who typed it, so if that administrator is removed the page asks for the key again. There is no environment variable for the key: a `ZETTA_TRANSCRIBE_API_KEY` that is still set is ignored (the server logs a warning at start), so save the key on that page.
- **The address** must be `https://` and not on a private network. An administrator who runs the provider on the local network turns on the setting `allowPrivateNetwork` in Studio > Server settings (the same switch as for MCP servers and WhatsApp; it applies at once); `http://` is then accepted too.
- **Test** sends one second of silence through the saved choice, so a wrong key, address or model shows up before anybody records.
- **Model on this server:** the **Model** field of the card takes a Whisper model from Hugging Face (`owner/name`, ONNX build, run at 8 bits); empty means `Xenova/whisper-small`. The change applies to the next recording and the model is downloaded then. Only one model is kept in memory. See "Which models for Portuguese" below for numbers.
- **Language:** Whisper assumes English unless it is told. The microphone sends the browser's language; the language set on that page serves voice notes (they have no browser). Tried on Portuguese speech, the `base` model was unusable and `small` close; a provider's larger model is the better route for languages other than English.

- **Off:** the first choice of the card, **Off (no recording or voice note is turned into text)**, switches speech to text off for everybody (the microphone button says it is off, a voice note reaches the bot as "(voice note)", voice mode is off). It replaces the old variable `ZETTA_TRANSCRIBE=off`.
- **Environment:** only `ZETTA_TRANSCRIBE_MODEL_DIR` (where the local model is kept) is still a variable: it is a fact about the machine. The old `ZETTA_TRANSCRIBE`, `ZETTA_TRANSCRIBE_MODEL` and `ZETTA_TRANSCRIBE_LANGUAGE` are imported once at the first start after an upgrade (see "Upgrading" in `docs/operations/server-settings.md`) and then have no effect; the model and language are the fields of the card.

Limits: one recording at a time on the local model, five minutes, six recordings a minute per person. A provider's refusal is shown as a fixed sentence (key refused, limit, too big, could not be reached): what the provider answered is never shown or stored.

## Reading messages aloud (text to speech)

A **Listen** button (a speaker icon) sits in the toolbar of every bot message, and in the "More" sheet on a phone. It reads the message aloud and stops when pressed again; only one message is read at a time. Code blocks, tool blocks, tables and the marks of Markdown are left out, and a link says its domain.

An administrator chooses who speaks in **Studio > Voice > Text to speech**, next to Speech to text:

| Choice                                | Where the text goes                                       | Notes                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The browser's own voice** (default) | Nowhere: the page speaks it on the device                 | No key, no cost. The voice and the languages depend on the device. The server sends the cleaned text, never audio.                                                 |
| **A voice on this server**            | Nowhere: Kokoro-82M runs inside the server                | No key, no cost, works offline after one download (about 100 MB, `ZETTA_SPEECH_MODEL_DIR`). English, Spanish and Brazilian Portuguese. Speaks on a phone call too. |
| **OpenAI**                            | `api.openai.com` (`/v1/audio/speech`)                     | Model `gpt-4o-mini-tts` and voice `alloy` unless you name others. Needs an API key.                                                                                |
| **ElevenLabs**                        | `api.elevenlabs.io` (`/v1/text-to-speech/{voice}/stream`) | Model `eleven_flash_v2_5` unless you name another; give the id of a voice of your account (a premade one is the default). Needs an API key.                        |
| **Another provider**                  | The address you give                                      | Any server that works like OpenAI's `/audio/speech` and answers raw 24 kHz 16-bit `pcm`. Needs the address and a key.                                              |
| **Off**                               | Nowhere                                                   | The Listen button is hidden and `POST /api/speech` answers 409.                                                                                                    |

**With a provider, the text of the message leaves this machine** for that provider, only when somebody presses Listen or talks in a voice call. The page says where the text goes before you save, and the Save button names the destination.

- **The key** is typed in that page, sealed in the browser, stored encrypted, and never shown again (`PUT` and `DELETE /api/connections/speech-key`, administrators only). There is no environment variable for the key: a `ZETTA_SPEECH_API_KEY` that is still set is ignored (the server logs a warning at start), so save the key on that page.
- **The address** of **Another provider** follows the same rule as speech to text: `https://`, not on a private network unless the administrator turned on the setting `allowPrivateNetwork`. The OpenAI and ElevenLabs addresses are fixed.
- **Test** speaks one short sentence through the saved choice and says whether the key, address, model and voice work (with the browser's voice there is nothing for the server to test).
- **Language:** the language field is a hint (a code such as `pt`). OpenAI's models work out the language from the text; ElevenLabs `eleven_flash_v2_5` takes it as `language_code`. OpenAI says its voices are tuned for English and that Spanish and Portuguese are supported, with an accent. ElevenLabs lists Portuguese and Spanish for `eleven_flash_v2_5` and `eleven_multilingual_v2`.
- **A voice for each bot:** the bot's settings page has a **Voice** section when text to speech is on. With a provider it is a voice name or id and a language, **saved on the bot on the server** (a call and later the phone have no browser to remember it; it is part of the bot's saved versions). With the browser's own voice it is a voice of the device, kept on the device, because device voices have names that mean nothing on another device. Empty means the voice chosen in Studio. The section has a **Listen voice** button that plays a short sample (in the language you set) with the voice **as chosen on the page, before you save it**, so a choice can be confirmed by ear; pressing it again stops it. With a provider, each press sends one short sentence to that provider.
- **Limits:** one request speaks up to 4,000 characters; the Listen button speaks about the first 1,500 (whole sentences, a minute and a half). Twenty requests a minute per person, six tests a minute per administrator. A provider's refusal is shown as a fixed sentence: what it answered is never shown or stored.

Press **Test** after saving a provider's key: it sends one short request and says whether the provider accepted it.

### The voice on this server (`local`)

**Model:** Kokoro-82M v1.0 (`onnx-community/Kokoro-82M-v1.0-ONNX`, Apache-2.0 weights; model card https://huggingface.co/hexgrad/Kokoro-82M), run at 8 bits through `@huggingface/transformers`, the same runtime as local Whisper. About 92 MB of model plus 0.5 MB per voice, downloaded once on first use into `ZETTA_SPEECH_MODEL_DIR` (default: the speech-to-text model folder, then `~/.cache/zetta/models`; pre-seed it for an offline server). **Phonemes** come from eSpeak NG (`espeak-ng` package, WASM, GPL-3.0, about 18 MB, no download). Output is 24 kHz, brought to 16 kHz.

- **Voices.** A voice id of Kokoro: `pf_dora`, `pm_alex`, `pm_santa` (Brazilian Portuguese), `ef_dora`, `em_alex`, `em_santa` (Spanish), `af_heart`, `am_adam`, `bf_emma` and the other English ones. Empty means the voice of the text's language (`pf_dora`, `ef_dora`, `af_heart`); a name that is not a Kokoro voice (for example `alloy` saved on a bot earlier) falls back to that default. The language comes from the call, then the language field of the card, then the words of the text.
- **Limits.** One text speaks at a time, up to four wait their turn, the next is told the server is busy; a text may take two minutes; up to 4,000 characters; the audio is made one sentence at a time, so the first sound plays after the first sentence (about 1 s for a short reply on a 10-core Mac) and the whole reply is made about twice as fast as it is spoken.
- **Switching it off** is choosing another provider on the card (**Off**, the browser's voice or a provider): the local model runs only when the provider is **This server**, and voice capabilities report `off` when the provider is **Off**. The **Model** field of the card names another Kokoro ONNX repository (`owner/name`); empty means `onnx-community/Kokoro-82M-v1.0-ONNX`. The old variables `ZETTA_SPEECH_LOCAL` and `ZETTA_SPEECH_MODEL` are imported once and then have no effect.
- **Where it runs.** On a server started with `bun`, in the Docker image and in the desktop app's dev mode. **Not in the single-file `bun build --compile` binary**: `@huggingface/transformers` does not load there (its image library `sharp` is a native module that is not embedded; checked on 2026-11-23), which is also why local Whisper and the embedding model are not shipped in the desktop app. There the voice reports "could not run" and a provider or the browser voice must be chosen.
- **What was tried and rejected** (2026-11-23). `kokoro-js` (Apache-2.0): its phonemizer package `phonemizer` carries only English data (asking it for `pt-br` or `es` fails), so it speaks English only; this adapter drives the same Kokoro model through `@huggingface/transformers` with the `espeak-ng` package for phonemes instead. `sherpa-onnx` (Apache-2.0) with its Kokoro multi-language model (132 MB archive): version 2 no longer phonemizes Portuguese or Spanish, and version 1.12's WASM build could not read model files from the host in a first attempt, so it was dropped. Piper: one model per voice (the sherpa-onnx int8 builds of pt_BR voices are about 21 MB each; `faber` is CC0), but it needs a phonemizer and a runtime of its own. Kokoro covers English, Spanish and Brazilian Portuguese with one 92 MB model.
- **Not a good fit when** the machine is short on memory (the model and the phonemizer take about 0.5 GB while loaded), or when the best voice quality matters more than privacy and cost: a provider's voice sounds better.

### Which models for Portuguese (measured)

Numbers: from `scripts/e2e/voice-quality.ts`, on a 10-core Apple-silicon Mac. Ten everyday sentences per language (dates, names, numbers), spoken by the local voice and by macOS `say`, read back by Whisper at 8 bits. The clips are synthetic and clean, so they rank models; they do not predict the rate of a real person.

| Whisper model (the card's **Model** field) | Disk   | Time for a 5 s sentence | Portuguese words right (local voice / `say`) | Spanish (local / `say`) |
| ------------------------------------------ | ------ | ----------------------- | -------------------------------------------- | ----------------------- |
| `Xenova/whisper-small` (default)           | 252 MB | 1.0 s                   | 90% / 90%                                    | 98% / 59%               |
| `Xenova/whisper-medium`                    | 779 MB | 2.6 s                   | 93% / 94%                                    | 99% / 71%               |
| `onnx-community/whisper-large-v3-turbo`    | 1.1 GB | 2.9 s                   | 95% / 96%                                    | 100% / 83%              |

- **Speech to text for Portuguese on a machine like this one: `onnx-community/whisper-large-v3-turbo`.** It is the most accurate, and only about three times slower than `small`, which is still well under the length of the sentence. `medium` costs nearly the same time for less accuracy and is not worth choosing. The default stays `small`: it is a quarter of the disk and loads in seconds, and on clean speech it already reads about nine words in ten. On a small server, or when the first answer must be quick, keep `small`. Choose the larger one in Studio > Decisions > Speech to text > Model, or with `ZETTA_TRANSCRIBE_MODEL`.
- **Voice for Portuguese: the local voice (`pf_dora`, or `pm_alex`/`pm_santa`).** Whisper reads it back as well as it reads macOS `say` (90 to 96%), it is the same on every machine (the browser voice is not, and the phone cannot use it), and it needs no key. Time to first audio was 0.9 s for a short reply and 3 s for the first sentence of a long one, with a real-time factor of 0.47.
- **When a provider is the better choice.** For the most natural voice (the local voice is clear but flat), for a machine that cannot spare the memory, for a compiled single-file server (the model does not run there), or when many calls overlap (the local voice speaks one text at a time). OpenAI's `/audio/speech` models are listed by OpenAI as deprecated with a shutdown on 2027-01-06, so for OpenAI prefer `gpt-4o-mini-tts` and watch that page; ElevenLabs `eleven_flash_v2_5` covers Portuguese and Spanish. A provider's speech to text (`gpt-4o-mini-transcribe`, a hosted Whisper large) is the better choice for noisy rooms and strong accents, which these clean clips do not test.

## Talking with a bot (voice calls)

A **voice call** is a live conversation with one bot inside Zetta: you speak, the bot answers in speech, and everything is saved as ordinary messages of that chat. The bot is the same bot: its memory, instructions, tools and permissions apply as for a typed message. Design and reasons: `docs/decisions/voice-and-phone.md`.

**It is on** when both halves work: speech to text (not **Off**: the server's own model, or a provider with its key) and text to speech (not **Off**: the voice on this server, a provider with its key, or the browser's own voice). `GET /api/voice/capabilities` answers `{ voice: "on" | "off", phone: "on" | "off" }` (`phone` is `on` only when the phone settings in `docs/operations/phone.md` are complete and the voice is one the server makes). Nothing else has to be set up, and there is no new variable.

- **Where.** Only a one-to-one chat with a bot: the chat page, and the chat panel beside a mailbox in Mail. A room and a chat with outside people cannot be called.
- **Cost.** Each thing you say is recognised (a provider charges per recording; the server's own model is free but slow on a small machine), the bot's turn runs as usual (its tokens), and each sentence of the reply is spoken (a provider charges per character; the browser's voice is free). A long call with a provider voice costs real money: the call ends after 30 minutes, or after 2 minutes without speech.
- **Privacy.** With a provider, what you say and what the bot answers leave this machine for that provider, as they do for the microphone and the Listen button. With the server's own model and the browser's voice nothing leaves.
- **The browser's voice.** The server sends each sentence as text and the page speaks it, so the call works with no key and no audio from the server. The server cannot hear the device's voice, so it paces itself by the length of the sentence.
- **One call at a time per person.** Starting another (another tab, another device) ends the first, which is told why.
- **Limits.** 30 minutes a call, 2 minutes without speech from either side (a bot at work is not silence), 12 tickets a minute per person. Audio is 16 kHz mono, 20 ms per message, at most 16 KB a message.
- **Saved.** The chat holds what you said and what the bot answered. A reply you interrupted is saved whole; `meta.voice.spokenChars` says how much of it was heard. The table `voice_call` has one row per call (who, which bot and chat, how it ended, how long) and the activity log has two events (`voice_call`, started and ended, with a closed reason, never the words).
- **A server that stops in the middle** marks the calls it held `failed` (reason `restart`) when a worker next recovers; the chat keeps the messages.
- **Several servers.** The ticket and the socket are worker-only (`ZETTA_ROLE=worker` or `all`): the load balancer file `docker/scale/Caddyfile` sends them there, and an `api` process answers 421. WebSockets need no extra proxy setting in Caddy; with another proxy, allow the upgrade on `/api/voice/socket` and a read timeout longer than two minutes (the server pings every 20 seconds).
- **Voice detection.** The server's detector hears any loud sound, not only speech, so the page must use the browser's echo cancellation. Phone calls: `docs/operations/phone.md`.
