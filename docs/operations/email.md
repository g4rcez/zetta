# E-mail plugin

The `mail` plugin gives a bot an inbox of its own. People you list write to its address, the bot reads the message and answers by e-mail. It speaks plain IMAP and SMTP, so it works with Gmail or Outlook (use an **app password**), iCloud, Fastmail or your own server.

Use a mailbox made for the bot, not your own.

1. Studio > Plugins > **E-mail** > Install: IMAP server (port 993 by default), SMTP server (465 by default, 587 also works), the address and password.
2. **Who may write to the bot**: addresses or `@domains`, comma separated. With none, nothing is delivered.
3. Under **Inbound** for the bot, add the E-mail route (it polls every minute or slower).
4. Turn on **Allow replies** when you want the bot to answer.

## What is read, and what is not

- The mailbox is read-only for Zetta: nothing is marked as read, moved or deleted. The first poll only remembers where the mailbox is; older mail is not delivered.
- A message is delivered only if the sender is on your list **and** the receiving server says the sender checks out (`dkim=pass` or `spf=pass` in `Authentication-Results`). A From line alone is easy to forge. For a private server that adds no such header, set **Check the sender** to no.
- Automatic mail (bounces, lists, out-of-office) and mail from the bot's own address are ignored, so two machines cannot answer each other forever.
- The quoted thread under the new words is cut; the text is capped; attachments are named in the message and never opened.
- Everything in a message is untrusted data. The bot's reply turn cannot run code or change anything; it has only `send_email` and the plugin's read tools.

## Replying

`send_email` goes only to the address of the chat it answers, and only when that address is on your list. Plain text, at most 5 a minute and 20 an hour. The server names are checked against the same private-network rule as MCP servers; an administrator can allow private addresses for a mail server inside your own network.

Not yet checked against a real mailbox; tested with a fake IMAP and SMTP.
