# Channels and inputs

Decided and built on 2026-11-15: documents, voice, Slack and e-mail.

## Documents

- PDF, Word (`docx`), PowerPoint (`pptx`), Excel (`xlsx`), CSV and TSV, up to 20 MB, on `POST /api/attachments` (`dataBase64`, like pictures). `chat/extract.ts` reads the text: PDF with `unpdf` (first 200 pages), Office files with `fflate` and their XML (at most 400 parts and 50 MB unpacked), tables as text. The text (at most 256 KB) is the attachment's content, the original is kept on disk like a picture, so the text reaches the turn as any attached file does: framed as untrusted data, and the turn counts as having seen outside content.
- A scan (no text), a damaged or password-protected file and a file that is not the type its name says are refused with a sentence.
- Not done: reading pictures inside documents, legacy `doc`, `xls` and `ppt`, OpenDocument.

## Voice

- `modules/transcribe/`: Whisper (`Xenova/whisper-small`, multilingual; `base` was unusable on Portuguese in a real run, and without a language Whisper assumes English, so the language is passed: the browser's for the microphone, `ZETTA_TRANSCRIBE_LANGUAGE` for voice notes) runs **in the server** through `@huggingface/transformers`, like the embedding model: the audio never leaves the machine. The model downloads once into `ZETTA_TRANSCRIBE_MODEL_DIR` (default `~/.cache/zetta/models`; `ZETTA_TRANSCRIBE_MODEL` picks another one); `ZETTA_TRANSCRIBE=off` turns it off. One recording at a time, five minutes at most, 120 seconds to finish.
- Web: a microphone button in the message box. The browser records, decodes and resamples to 16 kHz mono itself (`features/chat/audio.ts`), so the server needs no decoder for it; `POST /api/transcribe` returns the words, which go into the message for the person to read and change. At most 6 recordings a minute per person.
- Voice notes of outside people (Telegram, WhatsApp): the plugin's `poll` marks the event (`audio.ref`) and `fetchAudio` hands over the bytes (at most 10 MB, 5 minutes); `inbound/service.ts` transcribes up to five per poll with **ffmpeg** (added to the server image) and replaces "(voice note)" with the words, marked as transcribed automatically and maybe wrong. Without ffmpeg, or on any failure, the event arrives as "(voice note)".
- **Provider choice (2026-11-15, after the first run):** `installation_settings.transcribe_provider` is `local`, `openai` or `compatible` (any `/audio/transcriptions` server; `transcribe/remote.ts`), read on every recording by `transcribe/configured.ts`. Installation-wide because voice notes are transcribed with a background actor who is never an administrator. The key is a sealed connection of provider `transcribe` owned by the administrator who saved it (`PUT /api/connections/transcribe-key`, purpose `installation.transcribe-key`; hidden from the Accounts tab); the settings only record which one, and the API never returns it. If that administrator leaves the key reads as "unavailable" and nothing falls back silently to another provider. `ZETTA_TRANSCRIBE_API_KEY` is the operator's fallback when none was saved. The address goes through the private-network rule (`assertPublicUrl`); redirects are refused; the provider's words are never passed on; the key buffer is zeroed after each call. The audio now leaves the machine with a provider: the Studio card and the Save button say so. Language: the call's (the browser's) wins over the installation's, which serves voice notes.
- Not verified: a real OpenAI or other provider (tested with a local fake that checks the request); WhatsApp's voice download against a real WAHA server (tested with a fake one); Whisper with a real recording is checked in `docs/verification/e2e/voice.md` when it was run.

## Slack

- Plugin `slack`: the person creates a Slack app (scopes `app_mentions:read`, `im:history`, `chat:write`; events `app_mention`, `message.im`), pastes the bot token and the signing secret, and sets the app's Request URL to `/api/inbound/slack/hook/<user id>`. The server must be reachable from the internet.
- Slack **pushes** the messages, so `PluginInbound` gained `ingest(ctx, headers, raw, {filter})`: it verifies the signing secret (HMAC-SHA256 of `v0:timestamp:body`, five minutes of tolerance, timing-safe), answers Slack's one-time challenge, and returns the message. The inbound service stores it like a polled one (once per key, the same caps and framing) and starts the turn. A request that is not signed with this person's secret gets the same 401 as any other refusal. Without an enabled route the setup check still passes and nothing is kept.
- A direct message is its own chat; an @mention is a chat per thread. The same trust as Telegram: everybody who writes is an outside person, code off, only the reply tool and the read tool, for the chat the message came from.
- Replies: `send_message` (off until "Allow replies" is yes, rate limited, plain text with Slack's control characters escaped so a reply cannot ping `@channel`), `read_thread` (read, untrusted data).
- Decided: **no approve-in-Slack buttons** (an outside person's turn drops every write, so no card ever comes from one) and **one bot per workspace** (the route key stays one bot per plugin).
- Not verified against a real Slack workspace.

## E-mail

- Plugin `mail`: IMAP read-only (nothing marked, moved or deleted) and SMTP, any host. Cursor `{uidValidity, lastUid}`: the first poll remembers where the mailbox is, a rebuilt mailbox starts again from now, a poll cut short stops the cursor before the unread mail.
- Trust: delivered only when the sender is on the person's list (addresses or `@domains`) and, unless "Check the sender" is off, the receiving server's `Authentication-Results` says `dkim=pass` or `spf=pass`. With no list nothing is delivered. Automatic mail (`Auto-Submitted`, bulk) and the bot's own address are ignored; the quoted thread is cut; attachments are named, never opened.
- Replies: `send_email` only to the chat's own address, only if it is on the list, off until "Allow replies", at most 5 a minute and 20 an hour, plain text, no header injection. Hosts go through the same private-address policy as WhatsApp and MCP servers.
- Not verified against a real mailbox (tested with a fake IMAP and SMTP).
