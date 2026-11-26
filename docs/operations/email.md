# E-mail plugin

The `mail` plugin gives a bot an inbox of its own. People you list write to its address, the bot reads the message and answers by e-mail. It speaks plain IMAP and SMTP, so it works with Gmail (use an **app password**), iCloud, Fastmail or your own server. Outlook.com and Microsoft 365 no longer take a password over IMAP and SMTP: use the Microsoft connection below (it gives a mailbox in **Mail**, not this plugin).

Use a mailbox made for the bot, not your own.

1. Studio > Plugins > **E-mail** > Install: IMAP server (port 993 by default), SMTP server (465 by default, 587 also works), the address and password.
2. **Who may write to the bot**: addresses or `@domains`, comma separated. With none, nothing is delivered.
3. Under **Inbound** for the bot, add the E-mail route (it polls every minute or slower).
4. Turn on **Allow replies** when you want the bot to answer.

## What is read, and what is not

- The mailbox is read-only for Zetta: nothing is marked as read, moved or deleted. The first poll only remembers where the mailbox is; older mail is not delivered.
- A message is delivered only if the sender is on your list **and** your mail server says the sender checks out. A From line alone is easy to forge. Set **Receiving server name** to the name your server writes first in the `Authentication-Results` line of the mail it receives (open the source of a received message; Gmail writes `mx.google.com`). Only the topmost line with that name counts, and it must say `dmarc=pass` for the sender's domain, or `dkim=pass` for exactly that domain. Until the name is set nothing is delivered, and the plugin says so. For a private server where nobody can fake a sender, set **Check the sender** to no; with it off, anyone can write as an allowed address.
- Limits: SPF alone does not count, a DKIM signature of a parent or another domain does not count, and a message with more than one From line is ignored. A server that adds no such line cannot vouch for anyone.
- Automatic mail (bounces, lists, out-of-office) and mail from the bot's own address are ignored, so two machines cannot answer each other forever.
- The quoted thread under the new words is cut; the text is capped; attachments are named in the message and never opened.
- Everything in a message is untrusted data. The bot's reply turn cannot run code or change anything; it has only `send_email` and the plugin's read tools.

## Replying

`send_email` goes only to the address of the chat it answers, and only when that address is on your list. Plain text, at most 5 a minute and 20 an hour. The server names are checked against the same private-network rule as MCP servers; an administrator can allow private addresses for a mail server inside your own network.

## The inbox, the chat panel and how a bot sends

Separate from the `mail` plugin above, **Mail** in the sidebar is your own inbox: you connect an address (IMAP to read, SMTP to send; the password is stored sealed) and Zetta reads it live from the provider. The mail view itself is read-only: you cannot send from it, and nothing is moved, deleted or marked as read. Sending happens only through a bot.

**The chat panel.** Beside the inbox is a chat with the bot that owns the mailbox (or with Zetta's assistant when no bot does; set it in the mailbox settings). With a conversation open, every message you send carries that conversation, so "this" means it. The bot reads it with `mail_read`; what a mail says is outside content and never an instruction.

**Sending.** Each mailbox has **Sending** on or off in its settings. It starts on for a mailbox you connected by IMAP and for a bot's own address, and off for a Google or Microsoft mailbox that appeared by itself (see below). When it is off no bot can send from it, and the bot is told that only you can turn it on. When it is on, the server decides on every send:

- **You asked in your own chat, for people you pointed at: it goes out at once.** "Reply to this saying the invoices go out on Monday" with a conversation open sends a plain-text reply to the author of that conversation, threaded (`In-Reply-To`, `References`, `Re:` subject). "Email bob@example.com the schedule" sends a new mail to an address you wrote. The whole mail shows in the chat afterwards, and the bot gets a short receipt.
- **Anything else is a card.** If you did not ask for a mail ("summarise this"), if the bot read other mail, searched the mailbox or read anything outside before sending, if no conversation was open, if the recipient is someone you did not name, or if the turn was a routine or a goal loop, the bot shows a card with the mailbox, the exact recipients, the subject and the full text. Approve sends exactly that; Decline sends nothing. A card expires after 30 minutes. It is never remembered as "always allow".
- **Never from other places.** In a room, in an inbound chat (Telegram, WhatsApp, Slack, mail) or in a turn started by outside content the bot has no mail tools at all.

Limits: plain text only, To only (at most 5 recipients; no Cc, Bcc or files), at most 3 sends or cards per turn, and per mailbox 5 a minute and 20 an hour. Words that count as asking (English, Portuguese, Spanish): send, reply, respond, answer, write back, email, tell, let ... know; responde, envia, manda, escreve, avisa, diz; responde, envía, manda, escribe, contesta, avisa, dile. A question ("did Ana answer?"), a draft ("draft a reply") or an answer meant for you ("tell me") is not a request. When in doubt the result is a card.

**The copy in your Sent folder.** After the SMTP server takes a message, the same bytes are filed in the mailbox's sent folder (the one the server marks `\Sent`, else a common name such as Sent or Itens enviados; none is created), so you find it in your own mail app and in the conversation here. This is the one write Zetta makes to a mailbox. If it fails the mail still counts as sent and the bot's receipt says the copy could not be saved. Providers that file the copy themselves need nothing.

**What is recorded.** Every send, card, approval, decline and refusal is in the activity trail with the mailbox and the number of recipients. The trail holds no address, subject or text; those are in the card and in the chat.

The rule and its accepted risks are in [the security plan](../security/plan.md) (row C7, "Mail sent by a bot").

## Zetta's assistant and external AI clients

**The assistant (Chief)** manages mailboxes for you with the `zetta:mailbox` block, like every other setup tool. `list` and `get` answer at once (address, name, state, owner bot, sending; never a password or a message). `assign` (the owner bot, or none: the Chief reads it), `label` and `remove` are cards you approve; each one is about one mailbox and is never remembered as "always allow". `connect` opens a form in the chat for the address, the mail servers and the password: the browser looks the servers up for the address the assistant suggested, and seals the password before it leaves, so neither the chat nor the model sees it. `give_address` (a bot's own address, where an administrator turned bot addresses on) and `senders` (who may write to a bot's own address) are cards too. Turning **Sending** on or off and setting or reading a password are not tools: they stay in the mailbox settings, for you. No other bot has `zetta:mailbox`.

**MCP clients** (`/api/mcp`) get `list_mailboxes`, `list_mail_conversations` and `read_mail_conversation` with the read scope, and `change_mailbox` (owner bot and name) with the write scope. A client acts as you, not as a bot, so the rule is yours: your own mailboxes that are not retired, whichever bot owns them (the bot-only rule in `mail/access.ts` does not apply, because no bot is asking). Someone else's mailbox, a retired one and one that does not exist all answer "not found". What a mail says is framed as untrusted data, like the `mailbox` plugin does; every call is in the activity trail by tool and mailbox, never by content. There is **no send tool** over MCP: it has no approval card, and a mail goes out only through a bot, under the rules above. Reading mail through MCP sends it to the AI client you connected: grant the read scope only to a client you trust with your mail.

## Gmail through your Google connection

A Google account you already connected in **Studio > Plugins > Google** shows up in **Mail** by itself, with no app password and no mail server. Zetta reads it through the Gmail API with the access token the Google plugin already holds: the token stays in the plugin's sealed configuration and is never copied into the mailbox.

- **What it needs.** The account must have the permission **Gmail: read messages**. To let a bot send from it, also **Gmail: send email**. To add a permission, use **Change permissions** on that account in the Google plugin and sign in again. The Gmail API must be enabled in your own Google Cloud project (the plugin's setup guide says how).
- **What you see.** The inbox only (the INBOX label), newest first, with search in Gmail's own syntax (`from:ana newer_than:7d`). A conversation is a Gmail thread and includes the replies you sent. Attachments and inline images work as for any other mailbox.
- **Nothing is changed.** Zetta never adds or removes a label, marks a message as read, moves or deletes one. The driver only accepts a read of a profile, thread, message or attachment, and the one call that sends; any other call is refused before it leaves.
- **Sending.** A mail a bot sends goes through Gmail's `messages.send` with the threading headers and the thread id, so it lands in the same conversation. Gmail files the copy in Sent by itself. Sending starts **off** for a mailbox that appeared by itself (nobody chose it): turn it on in the mailbox settings. The same rules as every mailbox apply (your own request or a card, recipient limits, rate limits).
- **Several accounts.** Each connected Google account with the read permission is its own mailbox, one view each, never merged. Only your own Google installation counts, never the team's, and another person's account never appears.
- **When the sign-in breaks.** If the account is disconnected, its token was revoked or expired (a Google project in "testing" mode expires tokens after 7 days), or the read permission was taken away, the mailbox stays in the list as **Needs Google sign-in** and says where to fix it. It works again by itself once the account is back. A missing send permission refuses only the send; reading keeps working.
- **Removing it.** In Zetta, "remove" on a Google mailbox **hides** it: the row is kept, the Google account stays connected (disconnect it in the Google plugin) and it does not come back on the next visit. To bring it back, enter its address on **Connect a mailbox** and press **Already connected? Show it here**. If you disconnect the account in the Google plugin, a hidden mailbox is dropped, so connecting it again shows it as new.
- **Connect page.** For a Gmail address whose account is already connected, the page points to that mailbox instead of asking for an app password. If none is connected, it links to the Google plugin and keeps the app-password route (IMAP) as the alternative.

## Outlook and Microsoft 365 through your Microsoft connection

Microsoft turned off password sign-in for IMAP and SMTP in Exchange Online and Outlook.com, so these addresses need OAuth. A Microsoft account you connected in **Studio > Plugins > Microsoft** shows up in **Mail** by itself, like a Google account does: no password, no mail server. Zetta reads it through Microsoft Graph with the access token the Microsoft plugin holds (sealed in the plugin's configuration, never copied into the mailbox). The app registration is **yours** (Zetta has none of its own), so nothing depends on a Zetta-wide Microsoft app.

**Make the app registration** (also shown as the plugin's guide):

1. Open <https://entra.microsoft.com>, **Entra ID > App registrations > New registration**. Name it, for example "Zetta mail".
2. **Supported account types**: "Accounts in any organizational directory and personal Microsoft accounts" so Outlook.com and work or school accounts both work (the plugin uses the `common` authority). A single-tenant registration only signs in people of that organization: enter its tenant ID (or domain) in the plugin's **Tenant** field.
3. **Redirect URI**, one of two client types (choose the same in the plugin's **Client type**):
   - _Public client_ (default): platform **Mobile and desktop applications**, redirect `http://localhost`. Microsoft ignores the port of a localhost redirect when it matches. Under **Authentication** turn on **Allow public client flows**. No secret. The sign-in ends on a page that does not load; you paste its address back in Zetta (works from any server address).
   - _Web_: platform **Web**, redirect `<your Zetta address>/api/plugins/microsoft/callback` (a public https address), then **Certificates & secrets > New client secret** and copy the **Value** into the plugin.
4. **API permissions > Add a permission > Microsoft Graph > Delegated**: `Mail.Read`, `Mail.Send`, `User.Read`. Zetta adds `offline_access` to the sign-in by itself (that is what gives the refresh token). Do **not** add `Mail.ReadWrite`: Zetta never changes or deletes mail, and asks for nothing that could.
5. In a **work or school tenant** where users may not approve apps themselves, an administrator must press **Grant admin consent for the tenant** on the API permissions page, or the sign-in stops at "Need admin approval". Whether these permissions need an administrator depends on the tenant's consent settings.
6. In the plugin: paste the **Application (client) ID**, choose the client type (and secret for Web), tick **Read mail** (and **Send mail** if a bot should send), then **Sign in with Microsoft**. Repeat for each account (up to 10).

- **Sending.** Needs `Mail.Send`, and a new mailbox starts with sending **off**: turn it on in the mailbox settings. A reply is sent with Graph's `reply` action on the message being answered, so Outlook threads and quotes it itself and the recipient is the one Zetta worked out (a message's Reply-To wins over its From). A new message goes by `sendMail`, plain text. Exchange saves both in Sent Items, so Zetta stores no copy. Two consequences of those actions: the subject of an answer is Outlook's ("RE: ..."), and Graph does not report the Message-ID of what it sent.
- **Why not `createReply`.** It makes a draft and needs `Mail.ReadWrite`, which would let Zetta change the whole mailbox. The `reply` action needs only `Mail.Send`.
- **What is read.** The Inbox list is one Graph request per page (`/me/mailFolders/inbox/messages`, newest first, no bodies) and its messages are grouped by `conversationId`; a search uses `$search` (Graph sorts it itself and returns at most 1000 results). A conversation is one filtered request for all its messages in every folder, so your own replies in Sent Items are in it; drafts and what sits in Deleted Items or Junk are left out. Only real files are attachments (an attached e-mail or a link is not listed); they are read by `$value`, with the same 10 MB cap as every mailbox.
- **Page counts.** Because a list page is one request, the message count of a row only covers that conversation's messages on that page, and a conversation that continues on the next page shows up there again. The count is exact once the conversation is opened.
- **Read-only by construction.** The driver may only call: GET of the profile, one folder id, the Inbox list, a conversation's messages, one message's conversation id, its attachment list and one attachment's bytes; and POST of `sendMail` and `reply`. Move, flag, mark as read, delete and draft calls are refused before any request leaves.
- **When the sign-in breaks.** A disconnected account, a refresh token that expired or was revoked (or a policy that asks you to sign in again: `invalid_grant`, `interaction_required`) or a missing `Mail.Read` leaves the mailbox in the list as **Needs Microsoft sign-in**, with a sentence that points to the plugin. A missing `Mail.Send` refuses only the send. Microsoft's own words never reach the screen.
- **Removing.** "Remove" on a Microsoft mailbox **hides** it, exactly as for Google; the account stays connected in the plugin. **Disconnect** in the plugin forgets the tokens here. Microsoft has no token revocation endpoint for this flow, so Zetta cannot revoke them for you: also remove the app at <https://myaccount.microsoft.com/> (work or school) or <https://account.live.com/consent/Manage> (personal).
- **Connect page.** For an Outlook.com, Hotmail, Live or Microsoft 365 address (by name or by MX record) the page no longer says "not supported": it points to the mailbox when the account is connected, or links to the plugin. There is no password form, because Microsoft would refuse it.

## A mail address for every bot (Resend)

Decided 2026-11-22. A bot can have an e-mail address of its own, made when the bot is created, with nothing for its owner to type. The one-time setup that cannot be removed (a mail domain and a mail service account) is done once, by an administrator, in **Studio > Plugins > Bot e-mail address** (or through the Chief's installation form). Where nobody did it, bots get no address of their own, the settings page says so, and the IMAP mailbox and the `mail` plugin above stay the way to give a bot an inbox.

Zetta uses **Resend**'s plain receiving feature (not its paid "Inboxes" product) through a provider interface, so another provider can be added.

### Set it up, step by step

1. Make an account at resend.com and add a domain you own. Use a **subdomain** that carries no other mail (for example `bots.example.com`): Resend's receiving record is an MX record, and the mail server with the lowest MX value wins, so a domain that already receives mail must not be used.
2. Turn on **receiving** for the domain in Resend (the domain's page has a switch; sending needs to be on too).
3. Add the DNS records Resend shows for the domain at your DNS host (SPF, DKIM, and the MX record for receiving). Use the values Resend shows, not an example.
4. In Resend, make an API key (a key with sending access and the right to read received mail; Resend's "Full access" works). Keep it to yourself.
5. In Zetta, as an administrator: Studio > Plugins > Bot e-mail address > **Server setup**. Choose Resend, type the domain, save, paste the key and press **Save key**. The key is sealed in your browser, stored encrypted as a connection of yours and never shown again.
6. Press **Test**. It reads the domain at Resend and says whether it can send and receive, and lists the DNS records with "seen" or "not seen yet" for each. Add what is missing and test again.

From then on every **new** bot gets an address `<bot name>-<4 characters>@<your domain>`; an existing bot gets one with **Give this bot an address** in its settings (Plugins tab) or by asking the Chief. There is no automatic backfill.

### What it costs, as Resend states it

Read the pricing page (https://resend.com/pricing) the day you decide; this is what it said on 2026-11-22. Receiving costs nothing extra, but **each received email counts toward your transactional emails quota**, and so does each one a bot sends.

| Plan       | Price                                 | Emails per month     | Daily limit | Domains  | Data retention |
| ---------- | ------------------------------------- | -------------------- | ----------- | -------- | -------------- |
| Free       | $0                                    | 3,000                | 100 a day   | 3        | 30 days        |
| Pro        | $20 (50,000) or $35 (100,000) a month | 50,000 or 100,000    | none        | 10       | 30 days        |
| Scale      | $90 to $1,150 a month                 | 100,000 to 2,500,000 | none        | 1,000    | 30 days        |
| Enterprise | custom                                | custom               | none        | flexible | flexible       |

On a paid plan, mail beyond the quota is billed per 1,000 emails (the page says $0.46 to $0.90 depending on the plan); the free plan cannot go over. A busy bot on the free plan can hit the 100 a day limit, and then mail stops until the next day.

### Where the mail lives

- Mail to a bot address **passes through Resend** (it receives it, you poll it) and what a bot sends goes out through Resend's SMTP server (`smtp.resend.com`, user `resend`, the API key as password). Say so to the people who write to your bots.
- Resend keeps received mail only for its retention period, so Zetta **copies every message into its own Postgres** (`zetta.mailbox_message`, with the original source up to about 15 MB) when it polls. That copy is what the Mail page reads. Removing a bot's mailbox in Mail deletes its messages for good and retires the address for good (it is never given to anyone again).
- Archiving a bot retires its address: new mail to it is dropped and counted in the server log, nothing can be sent from it, and what was stored stays readable until the mailbox is removed.
- Renaming a bot keeps its address; the name on the mail it sends follows the bot's name.

### Who can make a bot answer

Mail from outside people reaches the bot only if the owner allowed the sender. In **Mail > the address > Settings > Who may write to it**, the owner lists addresses or `@domains` (the same list as the `mail` plugin). A message starts a turn of the bot only when **all** of this holds: the sender is on the list, Resend's own authentication results for the message say `dmarc=pass` (a sender whose domain publishes no DMARC record does not start a turn), a person wrote it (bounces, lists and auto-replies never start a turn), and it is not from the bot's own address. The turn is an outside-person turn like the `mail` plugin's: code access off, no other tools, and the only reply is to the address that wrote, threaded to its message, at most 5 a minute and 20 an hour. Mail from anyone else is stored and visible in the inbox, and the bot ignores it.

### How it runs

One poller (`modules/mail/poller.ts`) runs on the server's 30 second tick in the one process that does the background work, with a database lock so a second instance skips the pass. It asks Resend for mail newer than the stored cursor (`installation_settings.mail_cursor`), downloads each message once, stores it once per Resend id, and moves the cursor only after the mail is stored. After an error it waits 30 seconds, doubling up to 15 minutes. It needs no public address: polling works behind a firewall. The key is read on every pass from the installation settings, so changing it in Studio applies at once.

## Testing against a real server

The plugin was run through its own code against a real mail server: GreenMail (`docker.io/greenmail/standalone`, a Java IMAP and SMTP server made for tests) in a local container, with authentication on. The run covered install, connect and status, the first poll, delivery from an allowed sender, the sender checks (a stranger, a message nobody vouches for, automatic mail), a page cut short and read on, an HTML message with a file, `send_email` (including a subject with a line break), a rebuilt mailbox (the server restarted with a new `UIDVALIDITY`), a wrong password and a server that is not there. Reading left every message's flags as they were.

GreenMail adds no `Authentication-Results` header, so the "server vouches for the sender" check was exercised by writing that header into the test messages, as a receiving server does. It has no STARTTLS, so only the plain port was used (TLS and STARTTLS are covered by the fakes only).

To run it again (the engine binary must be a real path; on a Mac with Podman that is `/opt/podman/bin/podman`; the image is pulled on first use, and the container is removed afterwards):

```sh
cd apps/server
ZETTA_TEST_GREENMAIL=1 ZETTA_DOCKER_BIN=/opt/podman/bin/podman \
  bun --no-env-file test src/modules/integrations/plugins/mail.real.integration.test.ts
```

Without `ZETTA_TEST_GREENMAIL=1` the file is skipped. The same server also runs the mailbox driver tests (`src/modules/mail/imap.integration.test.ts`).
