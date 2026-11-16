import { uiToText } from "@zetta/render/chat-text";
import { simpleParser } from "mailparser";
import { assertPublicUrl } from "../../computer/service";
import {
  PluginError,
  registerPlugin,
  type InboundEvent,
  type PluginContext,
  type PluginDef,
  type PluginInbound,
  type PluginStatus,
} from "./registry";
import { createSendLimit } from "./send-limit";
import { clean, requiredText } from "./untrusted";

/**
 * E-mail as a channel, over plain IMAP and SMTP (works with any host: Gmail and Outlook with an app password, iCloud, Fastmail, your own
 * server). A bot has an inbox of its own: people write to that address, the bot reads what sender addresses the person allowed and
 * replies by e-mail to the address that wrote.
 *
 * Reading: IMAP, read-only (nothing is marked seen, moved or deleted). The cursor is `{uidValidity, lastUid}`, so a message is read once;
 * the first poll only remembers where the mailbox is (no backfill), and a mailbox that was rebuilt starts again from now.
 *
 * Trust: an e-mail's From line is easy to forge, so a message is delivered only when (1) the sender is on the person's list of allowed
 * addresses or domains, and (2) the receiving server vouches for it: its Authentication-Results header says dkim=pass or spf=pass
 * (switch it off with "Check the sender" = no, for a private server that does not add the header). Text is untrusted data like any
 * outside message; attachments are never opened (their names are listed).
 *
 * Replying: off until the person allows it, only to the address of the chat it answers (the reply tool takes the chat, not an address),
 * rate limited, plain text. Hosts go through the same address policy as MCP servers and WhatsApp (no private networks unless the
 * administrator allowed them).
 */
let policy = { allowPrivate: false };
/** Called once by the MCP service with its own `allowPrivate` option. */
export const configureMail = (p: { allowPrivate?: boolean }) => {
  policy = { allowPrivate: Boolean(p.allowPrivate) };
};

const MAX_SOURCE = 400_000;
const MAX_TEXT = 1700;
const MAX_SEND = 20_000;
const SEND_PER_MIN = 5;
const SEND_PER_HOUR = 20;
const FETCH_PER_POLL = 30;
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

type MailCfg = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
};
type Cursor = { v: 1; uidValidity: string; lastUid: number };
/** One message as the mailbox hands it over: its uid and the first bytes of its source. */
export type RawMail = { uid: number; source: Uint8Array };
export type Fetched = { uidValidity: string; uidNext: number; mails: RawMail[] };
export type Outgoing = { from: string; to: string; subject: string; text: string };
export type Mailer = {
  /** The mailbox's validity number and next uid, and the messages after `after` (none when `after` is null: the first look). */
  fetch(cfg: MailCfg, after: number | null, limit: number): Promise<Fetched>;
  send(cfg: MailCfg, mail: Outgoing): Promise<{ messageId: string }>;
  /** Connects and says who it is, to check the settings. */
  check(cfg: MailCfg): Promise<void>;
};

const cfgOf = (c: PluginContext): MailCfg => {
  const need = (k: string) => {
    const v = (c.config[k] ?? "").trim();
    if (!v) throw new PluginError("INVALID_FIELD", `The setting "${k}" is empty.`);
    return v;
  };
  const num = (k: string, fallback: number) => {
    const raw = (c.config[k] ?? "").trim();
    const n = raw ? Number(raw) : fallback;
    if (!Number.isInteger(n) || n < 1 || n > 65535)
      throw new PluginError("INVALID_FIELD", `The setting "${k}" is not a port number.`);
    return n;
  };
  const host = (k: string) => {
    const h = need(k).toLowerCase();
    if (!HOST.test(h) || h.length > 253)
      throw new PluginError("INVALID_FIELD", `"${clean(h, 40)}" is not a mail server name.`);
    return h;
  };
  return {
    imapHost: host("imapHost"),
    imapPort: num("imapPort", 993),
    smtpHost: host("smtpHost"),
    smtpPort: num("smtpPort", 465),
    user: need("user"),
    password: need("password"),
  };
};

/** The mail servers are typed by the person: the same address policy as every other user-supplied host. */
async function assertHosts(cfg: MailCfg) {
  if (policy.allowPrivate) return;
  for (const h of [cfg.imapHost, cfg.smtpHost])
    await assertPublicUrl(`https://${h}`).catch(() => {
      throw new PluginError(
        "BLOCKED_URL",
        "That mail server address is not allowed (private addresses must be enabled by the administrator).",
      );
    });
}

const real: Mailer = {
  async fetch(cfg, after, limit) {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapPort === 993,
      auth: { user: cfg.user, pass: cfg.password },
      logger: false,
      socketTimeout: 20_000,
      greetingTimeout: 10_000,
    });
    client.on("error", () => {});
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const box =
          client.mailbox && typeof client.mailbox === "object" ? client.mailbox : undefined;
        const uidValidity = String(box?.uidValidity ?? "0");
        const uidNext = Number(box?.uidNext ?? 1);
        const mails: RawMail[] = [];
        if (after !== null && uidNext - 1 > after)
          for await (const m of client.fetch(
            `${after + 1}:*`,
            { uid: true, source: { maxLength: MAX_SOURCE } },
            { uid: true },
          )) {
            // "n:*" always returns the newest message, even when it is not newer than n.
            if (m.uid > after && m.source) mails.push({ uid: m.uid, source: m.source });
            if (mails.length >= limit) break;
          }
        return { uidValidity, uidNext, mails: mails.sort((a, b) => a.uid - b.uid) };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async send(cfg, mail) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth: { user: cfg.user, pass: cfg.password },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const info = await transport.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
      return { messageId: String(info.messageId ?? "") };
    } finally {
      transport.close();
    }
  },
  async check(cfg) {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapPort === 993,
      auth: { user: cfg.user, pass: cfg.password },
      logger: false,
      socketTimeout: 15_000,
      greetingTimeout: 10_000,
    });
    client.on("error", () => {});
    await client.connect();
    await client.logout().catch(() => undefined);
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth: { user: cfg.user, pass: cfg.password },
      connectionTimeout: 15_000,
    });
    try {
      await t.verify();
    } finally {
      t.close();
    }
  },
};
let mailer: Mailer = real;
/** Test hook: replaces the IMAP and SMTP work with fakes. The platform never calls this. */
export const configureMailer = (m: Mailer | undefined) => {
  mailer = m ?? real;
};

/** Mapped to what the person can act on, never the server's own words (they can hold the user name or the address). */
function mailError(e: unknown, what: string): never {
  if (e instanceof PluginError) throw e;
  const code = String((e as { code?: unknown; responseStatus?: unknown })?.code ?? "");
  const auth =
    /AUTH|EAUTH/i.test(code) || (e as { authenticationFailed?: boolean })?.authenticationFailed;
  if (auth)
    throw new PluginError(
      "AUTH",
      "The mail server did not accept the user name and password.",
      "Check them (Gmail and Outlook need an app password) and install the plugin again.",
    );
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ESOCKET|EDNS/i.test(code))
    throw new PluginError(
      "UNREACHABLE",
      `The mail server could not be reached to ${what}.`,
      "Check the server name and port.",
    );
  throw new PluginError("MAIL_ERROR", `The mail server refused to ${what}.`);
}

/** The addresses or domains the person allowed (`ana@example.com`, `@example.com`, `example.com`), lower case. */
export const allowedList = (raw: string | undefined) =>
  (raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
export const senderAllowed = (address: string, list: string[]) => {
  const a = address.trim().toLowerCase();
  const domain = a.split("@")[1] ?? "";
  return list.some((x) =>
    x.includes("@") && !x.startsWith("@")
      ? x === a
      : (x.startsWith("@") ? x.slice(1) : x) === domain,
  );
};
/** Whether the receiving server vouches for the sender: DKIM or SPF passed in the header it adds. */
export const vouched = (header: string | undefined) => /\b(dkim|spf)=pass\b/i.test(header ?? "");

const textOf = (parsed: { text?: string | false; html?: string | false }) => {
  const plain = typeof parsed.text === "string" ? parsed.text : "";
  const body =
    plain ||
    (typeof parsed.html === "string"
      ? parsed.html
          .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<br\s*\/?>|<\/p>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
      : "");
  return (
    body
      // The quoted thread below the new words is not news.
      .split(/\r?\n(?:On .{5,200} wrote:|-{2,}\s*Original Message\s*-{2,}|_{5,})/i)[0]!
      .split(/\r?\n/)
      .filter((l) => !l.startsWith(">"))
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
};

/** One message of the mailbox as an event from an outside person, or undefined when it is not one the bot may answer. */
export async function toEvent(
  mail: RawMail,
  uidValidity: string,
  o: { allowed: string[]; strict: boolean; self: string },
): Promise<InboundEvent | undefined> {
  let parsed: Awaited<ReturnType<typeof simpleParser>>;
  try {
    parsed = await simpleParser(Buffer.from(mail.source), {
      skipHtmlToText: true,
      skipImageLinks: true,
      skipTextToHtml: true,
      skipTextLinks: true,
    });
  } catch {
    return undefined;
  }
  const from = parsed.from?.value?.[0];
  const address = (from?.address ?? "").trim().toLowerCase();
  if (!address || !/^[^\s<>@]+@[^\s<>@]+$/.test(address) || address === o.self) return undefined;
  if (!senderAllowed(address, o.allowed)) return undefined;
  const auth = parsed.headers.get("authentication-results");
  if (
    o.strict &&
    !vouched(Array.isArray(auth) ? auth.join(" ") : typeof auth === "string" ? auth : undefined)
  )
    return undefined;
  // Automatic mail (a bounce, a list, an out-of-office) is never answered, so two machines cannot talk to each other.
  const auto = String(parsed.headers.get("auto-submitted") ?? "");
  const precedence = String(parsed.headers.get("precedence") ?? "");
  if ((auto && !/^no$/i.test(auto)) || /bulk|list|junk/i.test(precedence)) return undefined;
  const subject = clean(parsed.subject, 160).trim();
  const body = textOf(parsed);
  const files = (parsed.attachments ?? [])
    .map((a) => clean(a.filename, 60))
    .filter(Boolean)
    .slice(0, 5);
  const text = [
    subject ? `Subject: ${subject}` : "",
    body.slice(0, MAX_TEXT),
    files.length ? `(attachments not opened: ${files.join(", ")})` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
  return {
    key: clean(parsed.messageId || `${uidValidity}:${mail.uid}`, 190),
    chat: address,
    chatName: clean(from?.name, 60) || address,
    from: clean(from?.name, 60) || address,
    text: text || "(empty message)",
    at: (parsed.date ?? new Date()).getTime(),
    media: files.length > 0,
    group: false,
  };
}

const inbound: PluginInbound = {
  label: "E-mail",
  minIntervalSeconds: 60,
  async poll(ctx, cursor, o) {
    const cfg = cfgOf(ctx);
    await assertHosts(cfg);
    const cur = cursor && typeof cursor === "object" ? (cursor as Cursor) : undefined;
    const allowed = allowedList(ctx.config.allowedSenders);
    let got: Fetched;
    try {
      got = await mailer.fetch(
        cfg,
        cur && cur.v === 1 ? cur.lastUid : null,
        Math.min(FETCH_PER_POLL, o.maxEvents * 2),
      );
    } catch (e) {
      return mailError(e, "read the mailbox");
    }
    // The first look, or a mailbox that was rebuilt: remember where it is now, deliver nothing from before.
    if (!cur || cur.v !== 1 || cur.uidValidity !== got.uidValidity)
      return {
        events: [],
        cursor: {
          v: 1,
          uidValidity: got.uidValidity,
          lastUid: Math.max(0, got.uidNext - 1),
        } satisfies Cursor,
        ...(cur && cur.uidValidity !== got.uidValidity
          ? { warning: "The mailbox was rebuilt by its server, so reading started again from now." }
          : {}),
      };
    const events: InboundEvent[] = [];
    let last = cur.lastUid;
    let cutShort = false;
    const limit = Math.min(FETCH_PER_POLL, o.maxEvents * 2);
    const strict = (ctx.config.requireAuth ?? "yes") !== "no";
    for (const m of got.mails) {
      // Enough for this poll: the rest stays unread (the cursor stops before it), and the next poll takes it.
      if (events.length >= o.maxEvents) {
        cutShort = true;
        break;
      }
      last = m.uid;
      // With no list of allowed senders nothing is delivered: an open inbox is an open door.
      const e = allowed.length
        ? await toEvent(m, got.uidValidity, { allowed, strict, self: cfg.user.toLowerCase() })
        : undefined;
      if (e) events.push(e);
    }
    return {
      events,
      // Everything up to the end of the mailbox was looked at only when the page was not full and nothing was left over.
      cursor: {
        v: 1,
        uidValidity: got.uidValidity,
        lastUid: cutShort || got.mails.length >= limit ? last : Math.max(last, got.uidNext - 1),
      } satisfies Cursor,
      ...(allowed.length
        ? {}
        : {
            warning:
              "No allowed senders are set, so no message is delivered. Add the addresses or domains that may write to the bot.",
          }),
    };
  },
  reply: {
    tool: "send_email",
    chatArg: "to",
    normalize: (c) =>
      String(c ?? "")
        .trim()
        .toLowerCase(),
  },
};

const sendLimit = createSendLimit({ perHour: SEND_PER_HOUR, perMin: SEND_PER_MIN });
/** Test helper. */
export const resetMailLimits = sendLimit.reset;
const yesNo = (v: string | undefined, label: string) => {
  if (v && !["yes", "no"].includes(v))
    throw new PluginError("INVALID_FIELD", `${label} must be yes or no.`);
};

const def: PluginDef = {
  id: "mail",
  name: "E-mail",
  icon: "envelope",
  category: "messaging",
  kind: "native",
  auth: "api-key",
  description:
    "Give your bot an inbox: people you allow write to its address, and the bot answers by e-mail. Works with any IMAP and SMTP server.",
  notes:
    "Use a mailbox just for the bot. Gmail and Outlook need an app password. Only mail from the addresses or domains you list is read, and only when the receiving server vouches for the sender (DKIM or SPF). Replies are OFF until you allow them, and go only to the address that wrote. Attachments are never opened.",
  fields: [
    {
      key: "imapHost",
      label: "IMAP server",
      placeholder: "imap.example.com",
      help: "Where the bot's mail is read.",
    },
    {
      key: "imapPort",
      label: "IMAP port",
      optional: true,
      placeholder: "993",
      help: "993 (SSL) by default.",
    },
    {
      key: "smtpHost",
      label: "SMTP server",
      placeholder: "smtp.example.com",
      help: "Where the bot's replies are sent from.",
    },
    {
      key: "smtpPort",
      label: "SMTP port",
      optional: true,
      placeholder: "465",
      help: "465 (SSL) by default; 587 also works.",
    },
    { key: "user", label: "User name (the address)", placeholder: "bot@example.com" },
    {
      key: "password",
      label: "Password",
      secret: true,
      kind: "password",
      help: "Stored encrypted and never shown again. Gmail and Outlook need an app password.",
    },
    {
      key: "allowedSenders",
      label: "Who may write to the bot",
      placeholder: "ana@example.com, @example.org",
      help: "Addresses or @domains, comma separated. Mail from anyone else is ignored. With none, nothing is delivered.",
    },
    {
      key: "allowSend",
      label: "Allow replies (yes/no)",
      optional: true,
      placeholder: "no",
      help: "The bot can send e-mail only when this is yes.",
    },
    {
      key: "requireAuth",
      label: "Check the sender (yes/no)",
      optional: true,
      placeholder: "yes",
      help: "Deliver a message only when the mail server says its sender checks out (DKIM or SPF). Turn off only for a private server that does not add that header.",
    },
  ],
  async install(ctx) {
    yesNo(ctx.config.allowSend, "Allow replies");
    yesNo(ctx.config.requireAuth, "Check the sender");
    const cfg = cfgOf(ctx);
    await assertHosts(cfg);
    try {
      await mailer.check(cfg);
    } catch (e) {
      mailError(e, "sign in");
    }
  },
  async status(ctx): Promise<PluginStatus> {
    try {
      const cfg = cfgOf(ctx);
      await assertHosts(cfg);
      await mailer.check(cfg);
      return {
        state: "connected",
        info: {
          address: cfg.user,
          allowedSenders: allowedList(ctx.config.allowedSenders),
          allowSend: ctx.config.allowSend === "yes",
          checkSender: (ctx.config.requireAuth ?? "yes") !== "no",
        },
      };
    } catch (e) {
      try {
        mailError(e, "sign in");
      } catch (p) {
        return {
          state: (p as PluginError).code === "AUTH" ? "needs-auth" : "error",
          detail: (p as PluginError).safe,
        };
      }
      return { state: "error" };
    }
  },
  async connect(ctx, options = {}) {
    const s = options.settings as Record<string, unknown> | undefined;
    if (s && typeof s === "object") {
      const next = { ...ctx.config };
      if (typeof s.allowSend === "boolean") {
        if (s.allowSend) next.allowSend = "yes";
        else delete next.allowSend;
      }
      if (typeof s.allowedSenders === "string") {
        const list = allowedList(s.allowedSenders);
        if (
          list.some((x) => !/^(@?[a-z0-9.-]+\.[a-z]{2,}|[^\s@]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(x))
        )
          throw new PluginError(
            "INVALID_FIELD",
            "Allowed senders are addresses (ana@example.com) or domains (@example.com).",
          );
        if (list.length) next.allowedSenders = list.join(", ");
        else delete next.allowedSenders;
      }
      await ctx.setConfig(next);
      return { message: "Settings saved." };
    }
    const cfg = cfgOf(ctx);
    await assertHosts(cfg);
    try {
      await mailer.check(cfg);
    } catch (e) {
      mailError(e, "sign in");
    }
    return { message: "Connected." };
  },
  inbound,
  tools: [
    {
      name: "status",
      description:
        "The address this plugin reads and sends from, who may write to it, and whether replies are allowed.",
      effect: "read",
      inputSchema: { type: "object", properties: {} },
      async handler(ctx) {
        return {
          address: cfgOf(ctx).user,
          allowedSenders: allowedList(ctx.config.allowedSenders),
          repliesEnabled: ctx.config.allowSend === "yes",
        };
      },
    },
    {
      name: "send_email",
      description:
        "Send a plain text e-mail to the person who wrote (the `to` you were given for this conversation). Works only if the person enabled replies; rate limited.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "The address of the conversation, as given in the incoming message",
          },
          subject: {
            type: "string",
            description: "Subject, max 160 characters (default: Re: your message)",
          },
          text: { type: "string", description: `The message, max ${MAX_SEND} characters` },
        },
        required: ["to", "text"],
      },
      async handler(ctx, args) {
        const body = requiredText(uiToText(String(args.text ?? "")), MAX_SEND);
        const to = String(args.to ?? "")
          .trim()
          .toLowerCase();
        if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(to) || to.length > 254)
          throw new PluginError("INVALID_ARGS", "to must be one e-mail address.");
        // Only an address the person allowed: a reply cannot be turned into mail to somebody else.
        if (!senderAllowed(to, allowedList(ctx.config.allowedSenders)))
          throw new PluginError(
            "NOT_ALLOWED",
            "That address is not on the list of allowed senders, so the bot cannot write to it.",
          );
        const subject =
          clean(String(args.subject ?? "Re: your message").replace(/[\r\n]+/g, " "), 160)
            .replace(/\s+/g, " ")
            .trim() || "Re: your message";
        if (ctx.config.allowSend !== "yes")
          throw new PluginError(
            "SEND_DISABLED",
            "Replying by e-mail is switched off for the E-mail plugin.",
            "Open Studio > Plugins > E-mail, turn on 'Allow replies', save, then ask again.",
          );
        if (!sendLimit.allow(ctx.userId))
          throw new PluginError(
            "RATE_LIMITED",
            `The e-mail sending limit was reached (${SEND_PER_MIN} a minute, ${SEND_PER_HOUR} an hour).`,
            "Wait a few minutes and ask again.",
          );
        const cfg = cfgOf(ctx);
        await assertHosts(cfg);
        try {
          const r = await mailer.send(cfg, { from: cfg.user, to, subject, text: body });
          return { sent: true, to, messageId: clean(r.messageId, 200) };
        } catch (e) {
          return mailError(e, "send the message");
        }
      },
    },
  ],
};

export const MAIL = registerPlugin(def);
