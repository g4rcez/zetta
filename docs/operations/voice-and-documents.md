# Voice and documents in chat

## Documents

Attach a PDF, Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`), CSV or TSV file (up to 20 MB) in the message box. Zetta reads its text on the server (PDF first 200 pages; text capped at 256 KB) and the bot gets it as attached content, framed as outside data. A scanned PDF with no text, a password-protected or damaged file, and a file that is not the type its name says are refused with a message. Pictures inside documents and the old `.doc`, `.xls`, `.ppt` formats are not read.

## Voice

- **Microphone button** in the message box: the browser records, the server turns it into words (`POST /api/transcribe`), and the words land in the box for you to read and fix before sending. Needs the browser's microphone permission.
- **Voice notes** sent to a Telegram or WhatsApp route are turned into text before the bot sees them, marked as transcribed automatically and possibly wrong. This needs **ffmpeg** on the server (the Docker image has it; on a Mac, `brew install ffmpeg`). Without it the bot sees "(voice note)".

### Who turns the audio into text

An administrator chooses, in **Studio > Decisions > Speech to text** (the choice covers the microphone and voice notes alike):

| Choice                    | Where the audio goes                            | Notes                                                                                                                                  |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **This server** (default) | Nowhere: a Whisper model runs inside the server | Downloads once, about 250 MB, into `~/.cache/zetta/models`. Slow on a small machine; weak in languages other than English.             |
| **OpenAI**                | `api.openai.com`                                | Model `whisper-1` unless you name another (for example `gpt-4o-mini-transcribe`). Needs an API key.                                    |
| **Another provider**      | The address you give                            | Any server that works like OpenAI's `/audio/transcriptions` (Groq, a self-hosted Whisper server). Needs the address and usually a key. |

The page says where recordings will go before you save, and the Save button names the destination. **With a provider, the audio of every recording leaves this machine** for that provider, under its rules.

- **The key** is typed in that page, sealed in the browser, stored encrypted, and never shown again (only "a key is saved"). It is saved as a connection of the administrator who typed it, so if that administrator is removed the page asks for the key again. An operator can instead set `ZETTA_TRANSCRIBE_API_KEY` in the server environment; it is used only when no key was saved.
- **The address** must be `https://` and not on a private network. An operator who runs the provider on the local network sets `ZETTA_ALLOW_PRIVATE_NETWORK=1` (the same switch as for MCP servers and WhatsApp); `http://` is then accepted too.
- **Test** sends one second of silence through the saved choice, so a wrong key, address or model shows up before anybody records.
- **Language:** Whisper assumes English unless it is told. The microphone sends the browser's language; the language set on that page serves voice notes (they have no browser). Tried on Portuguese speech, the `base` model was unusable and `small` close; a provider's larger model is the better route for languages other than English.

| Variable                     | Effect                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ZETTA_TRANSCRIBE=off`       | Turns speech to text off for every choice (the button reports it).                                                                       |
| `ZETTA_TRANSCRIBE_API_KEY`   | The operator's own provider key, used when none was saved in Studio.                                                                     |
| `ZETTA_TRANSCRIBE_MODEL`     | Another Whisper model id from Hugging Face, for **This server** (`Xenova/whisper-base` is smaller and faster, English only in practice). |
| `ZETTA_TRANSCRIBE_MODEL_DIR` | Where the local model is kept.                                                                                                           |
| `ZETTA_TRANSCRIBE_LANGUAGE`  | Language of voice notes when none is set in Studio (`pt`, `es`, `en`…).                                                                  |

Limits: one recording at a time on the local model, five minutes, six recordings a minute per person. A provider's refusal is shown as a fixed sentence (key refused, limit, too big, could not be reached): what the provider answered is never shown or stored.
