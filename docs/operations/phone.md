# Phone numbers for bots (operator setup)

A bot can have a real phone number. This page is for the person who runs the installation. The people who own bots do nothing here: they press **Give this bot a phone number** (or ask the Chief) and the number appears. Where this page was not followed, phone is simply not offered (`GET /api/voice/capabilities` answers `phone: off`).

Zetta, the assistant every person has, can have a number too: its Phone number section is the same as any other bot's. Zetta gets no extra powers on a call: an outside caller to its number can only leave a message or end the call, and the owner is recognised only by the registered number and the PIN.

**Status of the code.** Built: settings, the provider adapter, numbers (ask, approve, review, release, hold), the owner's own number and keypad PIN, the do-not-call list, and **incoming calls** (below). **Outgoing calls** are built too (see Outgoing calls). **Twilio is a second provider next to Telnyx** (below). **No real Telnyx or Twilio account was used, and no real call was made, in either direction.** The adapters, the webhook routes and the media socket were written from each provider's public documentation and tested against a fake Telnyx server and a fake Twilio server that sign real webhooks and open a real WebSocket to the real routes (`apps/server/src/modules/phone/fake.ts`, `fake-twilio.ts`, `calls.integration.test.ts`, `twilio.integration.test.ts`). Expect to fix small differences the first time a real account is used (the byte layout of L16 audio and the exact shape of the answer action are the likeliest); the Test button in Studio (below) is the first thing to run, then one call from your own phone.

## Choosing a provider

You choose the provider **per number**, not per installation. You can set up Telnyx, Twilio, or both in Studio, each with its own sealed key. When a number is asked for (by its owner, or by the Chief) or an existing one is attached, the provider is named: **Telnyx** or **Twilio**. If it is not named, the installation's **default provider** is used when it is ready, otherwise the only ready one. A provider that is named but not ready is refused with a sentence that says so. From then on the number belongs to that provider: its calls come in through that provider's webhooks, its outgoing calls are placed through it, and releasing it asks it. One installation can hold a Brazilian number at Telnyx and a US number at Twilio.

| Where the choice lives | What it is                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings, Telnyx       | `phone_provider` (`off` or `telnyx`: the **Telnyx switch**), its sealed key (`phone_connection_id`), public key, application id. These names were kept as they were when Twilio was added; read `phone_provider` as "Telnyx on or off". |
| Settings, Twilio       | `phone_twilio` (`off` or `on`), `phone_twilio_account_sid`, its sealed Auth Token (`phone_twilio_connection_id`).                                                                                                                       |
| Shared                 | `phone_public_url`, request mode, countries, limits, and `phone_default_provider` (`telnyx` or `twilio`).                                                                                                                               |
| On each number         | `phone_number.provider` (`telnyx` or `twilio`; the old `off` is never written and reads as Telnyx).                                                                                                                                     |

The API for the Studio and number pages: `GET /api/phone/offer` lists the ready providers, the countries each may serve (the one list you set) and the default; `POST /api/bots/:id/phone` and `POST /api/phone/numbers/attach` take an optional `provider`; every number view carries its `provider`; `POST /api/installation/phone/test` takes `{ "provider": "telnyx" | "twilio" }`; `PUT` and `DELETE /api/connections/phone-twilio-key` save and remove the Auth Token.

## What it costs, and in whose name

- A number is bought **on your Telnyx or Twilio account, in the name of whoever holds that account**. That person answers to the regulator for it and receives the bills.
- Prices Telnyx showed in November 2026 (check the pages, they change): local US numbers from about 1.00 USD a month ([numbers](https://telnyx.com/pricing/numbers)); Voice API about 0.002 USD a minute plus the SIP trunking fee (about 0.005 outbound, 0.0032 inbound), media streaming 0.0035 USD a minute, answering machine detection 0.002 USD a call ([voice](https://telnyx.com/pricing/voice-api)). The pricing pages did not list Brazil numbers or Brazil per-minute rates: read them in your Telnyx portal before you turn Brazil on.
- Prices Twilio showed on 2026-11-23 (check the pages, they change): a US local number $1.15 a month, inbound $0.0085 a minute, outbound $0.0140 a minute, Media Streams $0.0044 a minute, answering machine detection $0.0075 a call ([US voice pricing](https://www.twilio.com/en-us/voice/pricing/us)); a Brazil local number $4.25 a month, inbound $0.0100 a minute, outbound $0.0310 a minute ([Brazil voice pricing](https://www.twilio.com/en-us/voice/pricing/br)). The pages show a dollar sign without naming the currency code. Twilio's number search returns no price, so Zetta shows none.
- A number costs every month from the day it is bought, including while it is under review, held (see below) or unused. Zetta buys one **only when an owner asks**, never for every bot, and never above **Most numbers on this server**.
- Calls are recorded nowhere. Every call opens with a fixed sentence saying an automated assistant is speaking for the owner.

## Telnyx is a plugin (2026-11-24)

Telnyx is registered in the plugin registry as `telnyx` (`apps/server/src/modules/phone/telnyx-plugin.ts`) with its own settings: API key (sealed), public key and Call Control application id. Install it on **Plugins** like any other: for yourself, or, as the administrator, as the **team configuration** so every member and every shared bot uses one account. The plugin has no tools: bots still place and answer calls through the phone module, which asks for the account of the **number's owner** (their own configuration first, then the team's).

- **Webhook address of a plugin account:** `<public address>/api/phone/webhook/<owner user id>`. The id only chooses which key checks the signature, so an unknown id or a wrong signature is refused the same way. The old `<public address>/api/phone/webhook` keeps using the installation's Telnyx settings.
- **Order of lookup:** the owner's Telnyx plugin account, then the installation's old Telnyx settings (Studio > Phone numbers). Nothing was migrated or deleted. Moving a setup is: install the plugin, paste the same three values, change the application's webhook URL, then Disconnect the Telnyx card in Studio.
- **Still installation-wide** (shared with Twilio): the public address, countries, limits, request mode and the default provider.
- **Not done yet:** the Studio card still edits the old installation settings, the Numbers page does not show which account a number uses, the Chief's phone tools do not pass the person to the offer, and no real Telnyx account has been used.

## Twilio is a plugin too (2026-11-25)

Twilio is registered as the `twilio` plugin (`apps/server/src/modules/phone/twilio-plugin.ts`), the same way as Telnyx: **Account SID** and **Auth Token** (sealed) are its settings, saved for yourself or, by the administrator, as the team configuration so a shared bot's members use one account. No tools: bots place and answer calls through the phone module, which asks for the account of the number's owner (their own configuration, then the team's, then the installation's old Twilio settings).

- **Addresses of a plugin account:** `<public address>/api/phone/twilio/voice/<owner user id>` and `.../twilio/status/<owner user id>`. Twilio signs the whole address, so the id is part of what is checked, and it only chooses which Auth Token checks the signature. Zetta sets these addresses on a number itself when it buys or attaches it for that owner. The two plain addresses keep serving the installation's own account.
- **The public address stays an installation setting** (one address reaches this server whatever the account), so a plugin account needs it set in Studio > Phone numbers.
- **A number stays on the account that holds it.** A number bought on the installation's Twilio account is not moved by installing the plugin: attach it again after the owner installs it. The same holds for Telnyx.
- **Not done yet:** same list as Telnyx (the Studio card, `/api/phone/test`, the Chief's phone tools and the Numbers page still use the installation settings). No real Twilio account was used.

## Telnyx setup, step by step

1. Create a Telnyx account and fund it. Brazilian numbers need identity papers (below) before the order is approved.
2. **API key**: Telnyx portal > Keys & Credentials > API Keys > create a v2 key. You paste it into Studio; it is sealed in your browser, stored encrypted and never shown again.
3. **Public key**: Keys & Credentials > Public Key. Telnyx signs every webhook with the matching private key (Ed25519). You paste the public key into Studio: base64 of the 32 raw bytes, an SPKI DER in base64, or a PEM block all work.
4. **Call Control application**: Voice > Programmable Voice > Applications > add a Call Control application. Set its webhook URL to `<public address>/api/phone/webhook` (the route exists: see Incoming calls), API version v2. Note its **application id**. Optionally attach an **outbound voice profile** with a **daily spend limit** and the destination countries you accept: this is Telnyx's own cap on what a runaway bot could spend, and it is separate from the limits below.
5. **Public address** of this Zetta (below).
6. Studio > **Phone numbers** > the **Telnyx** card > **Connect**: paste the API key, the public key, the application id and the public address, then **Save and connect** and **Test**. Then choose who can ask and the countries (`BR, US`) under the cards.

The Chief's installation card only links to that page.

## Twilio setup, step by step

Twilio's pages read for this (2026-11-23) are listed at the top of `apps/server/src/modules/phone/twilio.ts`. **No Twilio account was available: nothing here ran against the real service.**

1. Create a Twilio account and fund it.
2. **Account SID and Auth Token**: Twilio Console > Account info. The Account SID (`AC` and 32 letters and digits) is not a secret: you type it in Studio. The **Auth Token** is: you paste it into Studio, where it is sealed in your browser, stored encrypted and never shown again. Zetta uses it as the password of the REST API (HTTP basic with the Account SID) and as the key that checks the signature of every webhook (`X-Twilio-Signature`). Rotating it in Twilio needs the same paste in Studio.
3. **Public address** of this Zetta (below). Twilio calls `<public address>/api/phone/twilio/voice` when a number rings and `<public address>/api/phone/twilio/status` for status and answering machine results, and opens a WebSocket to `<public address>/api/phone/stream`. When Zetta buys or attaches a number it sets these addresses on the number itself; there is no application to create.
4. Studio > **Phone numbers** > the **Twilio** card > **Connect**: paste the Account SID and the Auth Token, set the public address, then **Save and connect** and **Test**. Choose the **default provider** (shown when both are connected), who can ask and the countries under the cards.
5. Twilio's own spend cap: set usage triggers or a low auto-recharge in the Twilio Console, as for Telnyx's voice profile: it is a limit Zetta cannot see.

**How each country is handled.** Zetta searches local voice numbers (`AvailablePhoneNumbers/{country}/Local`). Twilio says in each result whether the number needs an address or a regulatory bundle (`address_requirements`: anything but `none`). Where it does, **Zetta does not buy it**: it answers "Twilio needs regulatory papers (a bundle and an address) for numbers there. Buy the number in the Twilio console with your company's bundle, then attach it here." Where it does not (the US, for example), the number is bought at once and its voice and status addresses are set in the same request.

**Brazil.** Twilio's page for Brazil ([guidelines](https://www.twilio.com/en-us/guidelines/br/regulatory)) says Brazil local numbers are **not available to individuals**: only a business, with proof of the business name (a commercial register excerpt), a Brazilian business address (a commercial register excerpt, utility bill, tax notice, rent receipt or title deed; not a PO box) and the CNPJ. The page does not say how the API takes the bundle and does not give a review time. So for Brazil at Twilio: create the bundle and the address and buy the number **in the Twilio console with your company's bundle**, then use **Use a number you already own** (attach) with `provider` Twilio. Zetta then finds the number on the account and points its voice and status addresses at itself.

**Differences from Telnyx that you may notice.** The call opens its audio on a WebSocket whose address takes no query string, so the one-time stream token travels as a custom parameter in the stream's first message; key presses (the owner's PIN) come on that same stream, not as webhooks; the audio is 8 kHz mu-law only; a call that rings on a number is considered answered when the stream opens. An outgoing call is created with inline TwiML and asks Twilio for asynchronous answering machine detection.

## The public address

The provider must reach Zetta from the internet: Telnyx sends webhooks (`POST /api/phone/webhook`), Twilio sends form webhooks (`POST /api/phone/twilio/voice` and `/api/phone/twilio/status`), and both open a WebSocket with the call's audio (`GET /api/phone/stream`). All of them must reach the **worker** process (`docs/operations/scaling.md`; `docker/scale/Caddyfile` does it). The proxy must pass WebSocket upgrades. The address must be `https://` with no path, for example `https://zetta.example.com`, and must reach this server's `/api` routes. Options:

- **A reverse proxy** you already run (Caddy, nginx, Traefik) with a real certificate, forwarding to Zetta. See `docs/operations/scaling.md` for the routes that must reach the worker (`/api/voice/*` and `/api/phone/webhook`, `/api/phone/twilio/voice`, `/api/phone/twilio/status`, `/api/phone/stream`).
- **A tunnel** (Cloudflare Tunnel, ngrok, Tailscale Funnel) for a machine at home. The tunnel's `https://` name is the public address. A tunnel whose name changes at each start breaks the setting each time: use a fixed name.

The **Test** button checks, as far as the server can: the address is `https`, its name resolves to a public internet address, and Zetta's own `GET /api/phone/health` answers there. **Neither provider offers a way to ask an address from outside**, so a pass means "something answers like Zetta from here", not proof that Telnyx's servers can reach it. It also asks the provider whether the key works and, when it says so, the account balance; for Telnyx, whether the application id exists; for Twilio, whether the account's number list can be read. **Twilio signs the address it called**: the public address must be exactly the one Twilio calls, with the same host (a request that names another host is refused) and no path.

## The Phone numbers page

All phone setup is on **Studio > Phone numbers** (administrators only; other people do not see the tab). From top to bottom:

- **Two provider cards**, Telnyx and Twilio, each with its logo, a one-line "good for" and a status: **Not connected**, **Connected**, **Key unavailable** (the saved key cannot be read) or **Needs attention** (no key, or the last Test failed). **Connect** opens the form in the card: the key (sealed in your browser, stored encrypted, never shown again), the provider's own fields (Telnyx: public key and call application id; Twilio: Account SID) and the **public address**. The address is one value shared by both cards: edit it in either one and the other shows it. A connected card folds to a summary with **Edit** and **Test**. **Test** checks what is saved (it waits while you have unsaved changes) and shows the server's sentence with a pass or fail mark. **Disconnect** asks first, switches the provider off and removes its key.
- **How people get numbers**: who can ask (**Nobody**, **Owners ask**, **Administrator approves**), the countries as chips with a picker, and the **default provider** (shown only when both are connected). It has its own **Save**. It appears once one provider is connected.
- **Advanced: limits**, folded: the most numbers, the longest call, and the minutes and calls a day per bot.
- **About costs**, a small note: you pay each provider, prices differ by country, the number is held in the account holder's name, calls are not recorded.

Each card saves only its own fields and the shared address, so saving one never wipes what you typed in another. A sentence about a field appears under that field.

Below the setup, the same page lists every number on the server:

- A table: the number, its **provider**, the bot (Zetta shows as itself), its owner, the status (requested, in review, active, held with the release date) and who may call.
- **Filters in the address**: status, provider and a text (a number, a bot or a person), for example `/studio/phone?status=held&provider=twilio`. A reload or a shared link shows the same list.
- Per row: **Approve and buy** or **Turn down** for a request; **Reassign** (a bot picker that shows each bot's owner and whether it already has a number; Zetta is a normal choice); **Release** (asks to confirm first).
- **Attach a number I own**: the number, the provider (asked only when both are ready) and the bot. The server's sentence is shown when it refuses (the number is not on the account, the country is not allowed, the bot already has one).
- The **do-not-call** list.

With only one provider ready, no screen asks which provider: the owner's request and the attach form use it. With both ready, the request form in the bot's settings shows a provider choice with the default chosen.

## Settings in Studio

| Setting                                                      | Meaning                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider (Telnyx)                                            | `off` or `telnyx`: the Telnyx switch.                                                                                                                                                                  |
| Twilio, Account SID                                          | `off` or `on`, and the Account SID (`AC...`, not a secret).                                                                                                                                            |
| Auth Token                                                   | Sealed connection of provider `phonetwilio`. Administrators only; never returned.                                                                                                                      |
| Default provider                                             | `telnyx` or `twilio`: used when a request names none and that provider is ready.                                                                                                                       |
| API key                                                      | Sealed connection of provider `phone`. Administrators only.                                                                                                                                            |
| Public key                                                   | For webhook signatures (public by design).                                                                                                                                                             |
| Call application id                                          | Telnyx Call Control application the numbers and calls belong to.                                                                                                                                       |
| Public address                                               | `https` origin the provider calls (the same for both).                                                                                                                                                 |
| Who can ask                                                  | `off`: nobody. `owner_request`: the owner asks and the number is bought at once. `operator_approval`: the owner asks, an administrator approves (Studio list, or the Chief's card), then it is bought. |
| Countries                                                    | Two-letter codes numbers may be bought in. Empty: none.                                                                                                                                                |
| Most numbers                                                 | Counts numbers that cost money (in review, active, held). Checked again at approval.                                                                                                                   |
| Longest call, minutes per bot per day, calls per bot per day | Longest call is for the owner (an outside caller gets 5 minutes at most); the daily numbers count the last 24 hours per bot; 0 means no calls.                                                         |

## Numbers, in plain words

- **One per bot.** The owner chooses a country and, if they like, an area code. A request waiting for approval costs nothing.
- **Under review** (`pending_review`): the order was placed and Telnyx or the regulator is still checking the papers. For Brazil Telnyx says this can take up to 3 business days; the owner is told so. A job checks the order periodically and the number becomes active, or fails (and is given back).
- **Archive**: when a bot is archived its number is **held for 30 days**: it keeps costing, calls will be answered "not in service", and it is released afterwards. An administrator can release it at once in Studio. Restoring an archived bot does not bring its held number back; the owner asks again.
- **Release**: the owner (or an administrator) releases a number; it goes back to Telnyx. A number still waiting in review cannot be cancelled through the API Zetta uses: cancel the order in the Telnyx portal if you need to.
- **Who may call it**: `owner_only` (default), `anyone`, or `off`. **Calls out**: on or off. The owner's own number and a **keypad PIN** (4 to 8 digits, stored as a salted hash, three wrong tries lock it for 30 minutes) are how the owner is recognised when they call their bot. Caller ID alone never is.
- **Do not call**: an installation-wide list of numbers no bot will call (administrators add and remove them in Studio or by the Chief; a person who asks on a call not to be called again is added by themselves). Bots may call any other number: there is no allow list.

## Use a number you already own

Instead of letting Zetta order a number, an administrator can give a bot a number the Telnyx account **already holds**, for example one bought in the Telnyx portal. Zetta orders nothing and nothing waits for review.

- **Where to buy it**: in the Telnyx portal, on the same account whose API key you saved in Studio. Buy a voice-capable number there.
- **What Zetta does** when an administrator attaches it (Studio, or the Chief's `zetta:phone` `attach` as an approval card each time): checks the number is valid and in a country offered here; checks the account holds it and it is active; checks no bot already uses it; **routes it to the installation's call application** (the one saved in Studio, the same one orders use); records it as `active` for the bot's owner, with "owner only" for who may call and calls out on. The limit of numbers in Studio counts it like any other.
- **Who may do it**: administrators only. The bot must not be archived and must have no number or request. Zetta (the Chief) can be given one.
- **Reassign** (`reassign`, administrators only, a card each time in the Chief): moves an `active` or `held` number to another bot that has none, refused while a call is running on it. It **clears** what belonged to the old owner: the registered own number, the PIN, failed tries and the hold; the new owner sets their own. A held number becomes active.
- **Nothing is configured through environment variables.** The key, the application and everything else are Studio settings in the database; a test fails if the phone module reads `process.env`.
- **Telnyx request, as built**: `GET /phone_numbers?filter[phone_number]=<e164>` to find the number (its `id`, `connection_id`, `status`), then `PATCH /phone_numbers/{id}` with `{"connection_id": "<call application id>"}` (skipped when it already points there). Documented at <https://developers.telnyx.com/api-reference/phone-number-configurations/update-a-phone-number> and <https://developers.telnyx.com/api-reference/phone-number-configurations/list-phone-numbers>. Not confirmed: that a real account accepts exactly this on a number bought in the portal (nothing was run against Telnyx), and whether a number needs extra requirements (an address, a regulatory group) before it can be routed; the page for the separate `PATCH /phone_numbers/{id}/voice` does not take `connection_id`.

## Brazilian numbers

For Twilio see the Twilio section above (company only, buy in the console, attach). For Telnyx: Telnyx's page for Brazil ([Brazil DID requirements](https://support.telnyx.com/en/articles/5464041-brazil-did-requirements)) lists for an individual: a CPF number, a copy of a passport or ID, a Brazilian address, and a proof of address dated within the last 3 months; review can take up to 3 business days. Other providers say Brazilian local numbers need a company (CNPJ): **confirm with Telnyx support that an individual order is accepted today** before relying on it. Telnyx's order API puts the papers in `regulatory_requirements` of the sub number order (and optional requirement groups for pre-approval); Zetta does not submit papers and does not send a `requirement_group_id`, so a Brazilian order placed from Zetta can sit in review for good. Buy the number in the Telnyx portal with your papers, then use **Use a number you already own** (attach): Zetta points it at its Call Control application. Checked against Telnyx's developer docs on 2026-11-24: they name no Brazil rule, so the Telnyx support page above stays the reference.

## Incoming calls

What happens when someone rings a bot's number (the Twilio differences are in the Twilio section):

0. A call to a number is handled only by the provider the number belongs to: a Twilio number rung through Telnyx's address (or the other way round) is turned away.
1. Telnyx sends `call.initiated` to `/api/phone/webhook`. Zetta checks the signature and age of the event, records its id in the database (so several instances agree; a repeat is refused with 409), decides what to do with the call and answers it with a one-time stream address.
2. Telnyx opens `GET /api/phone/stream?token=...` and sends the caller's audio (16 kHz linear, or 8 kHz mu-law if the stream says so); Zetta sends the bot's voice back, and a `clear` when the caller talks over it.
3. Every call starts with a fixed sentence, in the bot's voice language (English, Portuguese or Spanish): "Hello, this is _owner name_'s automated assistant." It cannot be switched off or changed.

Who gets what:

| Caller                                                                                    | What happens                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Number not `active` (held, in review) or "Who may call it" is `off`                       | The opening sentence, "this number is not in service", hang up.                                                                                                                                                                                                                                    |
| The bot is already on a call                                                              | "On another call, try later", hang up. A second call never disturbs the first.                                                                                                                                                                                                                     |
| "Who may call it" is `owner_only` and the caller is not the owner's number with a PIN set | The opening sentence, "this number only takes calls from its owner", hang up.                                                                                                                                                                                                                      |
| The caller ID is the owner's registered number and a PIN is set                           | The assistant asks for the PIN on the keypad (digits, then `#`; `*` starts again). Right: an **owner call**. Three wrong tries lock the PIN for 30 minutes (even the right one is refused then). No key press in 15 s, or a locked PIN: `owner_only` hangs up; `anyone` goes on as for any caller. |
| Anyone else (`anyone`)                                                                    | An **outside call**.                                                                                                                                                                                                                                                                               |
| Over the bot's calls or minutes of the last 24 hours                                      | "Cannot take more calls now", hang up (the owner's own number is not held to it at the start).                                                                                                                                                                                                     |

**Caller ID is never enough.** The owner's number only makes the assistant ask for the PIN; anyone can fake a caller ID. Without the PIN a caller is an outside person.

**An owner call** is an ordinary chat of the owner with the bot (it appears in the chat list as "Phone call"). What the bot writes is _not_ applied at once, as it is when you type: speech recognition makes mistakes and a number can be faked, so each change waits for an Approve card. Set the owner's number and the PIN on the bot's phone settings (a PIN is 4 to 8 digits and is never shown again).

**An outside call** is an "incoming message" conversation like one from Telegram or WhatsApp (under the bot's conversations, titled "Phone · +number"). The caller's words are untrusted: the bot runs without code, without your memory or mail, cannot call anyone, and has exactly two tools: **take a message** (a note in the conversation and a card for you in Catch up, "_number_ left a message for _bot_") and **end the call**. Asking it to read your mail, to call a number, or "ignore your rules" gets nowhere.

**Do not call me.** A caller who says they do not want to be called again ("don't call me", "não me ligue", "no me llames") is put on the installation's do-not-call list (reason `caller_request`), noted in the conversation. Administrators can remove a number in Studio.

**Limits.** One call at a time per bot; 5 minutes for an outside caller; the installation's _Longest call_ for the owner; the daily calls and minutes per bot; 20 seconds without anyone speaking ends the call; a number that has had 30 refused calls in an hour is rejected without being answered (it then costs nothing but the number).

**Records.** Nothing is recorded as audio. Each call is a row in the call list (number, caller, trust, how it ended, how long) and its words are the conversation's messages. Calls started and ended are in the audit trail like web calls.

**Phone needs a voice the server makes.** With only the browser's own voice set in Studio, phone is not offered. Choose the local voice or a provider.

## Outgoing calls

A bot with an active number whose "Outgoing calls" switch is on can call any number it is asked to call. It is the person's own request that approves a call; otherwise the person gets a card.

**When a call goes out at once.** Only when the person typed, in their own chat with the bot, a request to call ("call +1 202 555 0123 and ask whether the order arrived", "ligue para...", "llama a..."), wrote the number in that message (or asked to be called on the owner's number registered in the bot's phone settings), and the bot had read no web page, file or other outside content first. Anything else that is allowed shows a card with the number (formatted), the country, what the call will say and ask, the longest it may take, and what to do on an answering machine. There is no "always allow" for calls. Loop steps, routines and turns Zetta started show a card. Rooms, inbound chats, turns started by outside events and the call's own turn have no call tool.

**What is blocked, whoever asks** (in the code; none of it is a setting):

- emergency numbers of the countries Zetta knows (for example Brazil 190, 192, 193, 199; 112; 911; 999) and anything that is not a valid international number;
- numbers of other bots of this installation (calls between bots);
- numbers on the do-not-call list;
- premium-rate and shared-cost numbers;
- countries not in **Countries** in Studio (an empty list allows no call at all: set the countries calls may go to), and the daily calls and minutes per bot, and the longest call.

**Calling hours.** A call the person did not ask for in that turn (a loop, a routine) is placed only between 08:00 and 20:00 where the person called lives. A country with several time zones must be inside the hours in all of them; Brazil is read by area code; a country Zetta has no zone table for is treated as closed. A call the person asked for now, or to the owner's own number, is not held to the hours.

**What the other party hears.** The first sentence is fixed and cannot be changed: "Hello, I'm an automated assistant calling on behalf of _your name_." (Portuguese and Spanish follow the bot's voice language). If an answering machine picks up, the call hangs up without a word, unless the card said to leave the message. Nothing is recorded. 20 seconds of silence ends the call.

**Do not call me.** A person who says so is put on the do-not-call list (reason `caller_request`) and the call ends politely; no bot calls that number again until an administrator removes it in Studio.

**What the person sees.** While the call runs, the chat that asked shows a "Hang up" card. When it ends, one short note: how it went, how long, and two lines of summary (retold from what the other party said: treat it as text from outside), with a link to the call's own chat, where the whole exchange is. The call list of the Chief (`zetta:phone` `calls`) and of an MCP client (`list_calls`, `get_call`) shows numbers, outcomes and lengths, never words.

**Your account is the second cap.** Set an outbound voice profile in Telnyx with a daily spend limit and the destination countries you accept (the profile's whitelisted destinations): it limits what a runaway bot could cost, independent of Zetta. Check the per-minute price of each destination in your portal before you allow a country.

**You are responsible for consent.** Calls the bot places are calls placed in your installation's name. Whether a call needs the callee's consent, may be made at all, or counts as marketing or telemarketing depends on the country. In Brazil look at "Não Me Perturbe" (the national do-not-call registry) and the telemarketing rules of Anatel; in the US at the TCPA and the national Do Not Call list; in Europe at the rules on unsolicited calls. These are things to check, not legal advice. The do-not-call list in Zetta only remembers people who asked on a call or whom an administrator added; it does not read any national registry.

## What is not proven yet

**Twilio (nothing ran against a real account):**

- That the webhook signature is computed as Zetta does (HMAC-SHA1 with the Auth Token over the called address and the sorted form parameters, key and value glued, base64). Twilio's security page names the parts but does not write the string out, and its worked example gives no Auth Token, so no value from Twilio's documentation could be reproduced. The adapter checks against a value made independently with `openssl`. How a port other than 443 appears in the called address is not in the documentation either.
- That the stream's first message (`start`) carries the `<Parameter>` values in `customParameters` (the stream page says it does; its message shape comes from the message reference), and that Twilio opens the socket with no query and no credential of its own. Zetta does **not** check any signature on the WebSocket handshake; the one-time token is the credential.
- That the TwiML `<Connect><Stream>` followed by `<Hangup/>` ends the call when Zetta closes the socket (the page says the verbs after it run when the socket closes), and that asynchronous answering machine detection works while a bidirectional stream is open (the machine detection page warns that Media Streams started while detection runs share its forked streams; it is not clear that a `<Connect><Stream>` counts).
- That `StatusCallback` is accepted on an update of an existing number (only the create page lists it) and that the delete answers `204` (not stated); that fetching one number by its sid is as Zetta assumes; the exact error Twilio gives when a purchase lacks a bundle (Zetta avoids the call by reading `address_requirements`).
- That a webhook is answered within Twilio's patience: Zetta waits at most 8 seconds for the call's answer and then rejects with `<Reject reason="busy"/>`; Twilio's page names no timeout.
- **Replay**: Twilio's signature has no timestamp. Zetta keeps the id of each webhook (`CallSid`, status and sequence number) in the database for an hour, so a replay inside that hour is refused by every instance; a captured request replayed later passes the signature, but a voice webhook for a call that does not exist only creates a ringing row that no stream ever joins and that ends by itself, and a status callback of an unknown call does nothing.

- (Telnyx) Everything about Telnyx's real behaviour: the answer action with stream options, the order and timing of its events, the audio (Telnyx streams PCMU 8 kHz by default; L16's byte order is not documented, so Zetta asks for PCMU), whether the stream also sends key presses (Zetta reads them from `call.dtmf.received` only), and how fast its servers close a socket. The fake Telnyx in the tests follows the documentation, not the service.
- **No real call was ever placed**: no Telnyx account was available. For outgoing calls in particular: that a dial with `stream_url` opens the stream when the callee answers, the timing of `call.machine.detection.ended` (Zetta waits 8 s for it before it greets, and also reads a late result), the `result` values of the premium detection, that `time_limit_secs` counts as assumed, that the outbound voice profile refuses what it should, how long a call rings before Telnyx gives up (Zetta gives up after 60 s of its own), and how well the detection tells a person from a machine on real lines.
- Call quality (latency of the recognizer and the voice over a real line, echo, noise), and Brazilian number papers.
- Several workers: the webhook and the socket must reach the same worker for a call; the person's Hang up must too (it is worker-only like the webhook); with one worker (the default) nothing needs doing.

## Limits of this foundation

- `PUT /api/connections/phone-key` and `PUT /api/connections/phone-twilio-key` (like the other `-key` routes) opens a key sealed to the transport key of one process. Behind a load balancer send it to the worker (see `worker-only.ts`).
- The adapter does not run on the compiled single-file server differently from the rest: it only uses `fetch` and `node:crypto`. Number types and validity come from `libphonenumber-js` (MIT, bundled and checked under `bun build --compile`).
- The card shows no cost per minute: Zetta holds no rate for the provider's destinations.
- A call in progress when the server restarts is marked failed.
