/**
 * What the mailbox routes call: it joins the owner-scoped store, the driver and the sealed password. Mail is read live; nothing is copied
 * and the mailbox is never changed.
 *
 * The password is a sealed connection (provider `mailbox`) owned by the person. It is read for one call, handed to the driver and the
 * buffer is zeroed; no result carries it or the connection id.
 */
import { uuidv7 } from "@zetta/core/uuid";
import type {
  MailboxConfig,
  MailboxKind,
  MailboxSending,
  MailboxState,
} from "@zetta/db/schema/mail";
import type { ActiveActor } from "../identity/access";
import type {
  AttachmentBytes,
  ConversationPage,
  MailAddress,
  MailboxDriver,
  MailMessage,
  OutgoingMail,
  SentMail,
} from "./driver";
import type { GoogleMailAccess } from "../integrations/plugins/google/mail-access";
import type { MicrosoftMailAccess } from "../integrations/plugins/microsoft/mail-access";
import { SENDER_PATTERN } from "@zetta/core/mail-provision";
import { createGoogleDriver } from "./drivers/google";
import { createMicrosoftDriver } from "./drivers/microsoft";
import { createProvisionedDriver } from "./drivers/provisioned";
import type { MessageStore } from "./messages";
import type { MailProvider } from "./providers/provider";
import { closeImapMailbox, createImapDriver } from "./drivers/imap";
import { MailConnectError } from "./imap-connect";
import {
  htmlToText,
  imageTypeOf,
  referencedCids,
  sanitizeMailHtml,
  SANITIZE_LIMITS,
  type HtmlSize,
  type ImageMode,
  type InlinePart,
  type RemoteImages,
} from "./sanitize";
import type { AccountKind, Mailbox, MailboxStore } from "./store";

/** The connections the mail service needs; `ConnectionsService` fits. */
export type MailSecrets = {
  create(
    a: ActiveActor,
    v: { provider: string; label: string; secret: string },
  ): Promise<{ id: string }>;
  list(a: ActiveActor): Promise<readonly { id: string; revision: number }[]>;
  revoke(a: ActiveActor, id: string, revision: number): Promise<unknown>;
  secretFor(a: ActiveActor, id: string): Promise<Buffer>;
};

/** What a driver that has no password of its own needs: who is asking, and the way to the person's Google or Microsoft connection. */
export type DriverContext = {
  actor: ActiveActor;
  google?: GoogleMailAccess;
  microsoft?: MicrosoftMailAccess;
};

/** Builds the driver of one mailbox. The password is the plain text for this call only; a Google mailbox has none (its token stays in the Google plugin). */
export type DriverFactory = (
  mailbox: Pick<Mailbox, "id" | "kind" | "address" | "config">,
  password: string,
  context?: DriverContext,
) => MailboxDriver;

/** A refusal of the service itself, with a sentence the person can read. */
export class MailServiceError extends Error {
  constructor(
    readonly code:
      | "NOT_AVAILABLE"
      | "NO_PASSWORD"
      | "RETIRED"
      | "BAD_INPUT"
      | "SENDING_OFF"
      | "NO_GOOGLE"
      | "NO_MICROSOFT",
    message: string,
  ) {
    super(message);
    this.name = "MailServiceError";
  }
}

/** The driver of each kind. `provisioned` has none yet: add a case here and nothing else changes. */
export const defaultDriverFor: DriverFactory = (mailbox, password, context) => {
  switch (mailbox.kind) {
    case "imap": {
      const c = mailbox.config;
      if (!c.imapHost || !c.imapPort || !c.smtpHost || !c.smtpPort || !c.user)
        throw new MailServiceError("BAD_INPUT", "The mail servers of this mailbox are not set.");
      return createImapDriver({
        key: mailbox.id,
        address: mailbox.address,
        server: {
          imapHost: c.imapHost,
          imapPort: c.imapPort,
          smtpHost: c.smtpHost,
          smtpPort: c.smtpPort,
          user: c.user,
          password,
          ...(c.imapSecurity ? { imapSecurity: c.imapSecurity } : {}),
          ...(c.smtpSecurity ? { smtpSecurity: c.smtpSecurity } : {}),
        },
      });
    }
    case "google": {
      if (!context?.google)
        throw new MailServiceError("NOT_AVAILABLE", "Google mailboxes are not available here.");
      return createGoogleDriver({
        address: mailbox.address,
        transport: context.google.transport(context.actor, mailbox.address),
      });
    }
    case "microsoft": {
      if (!context?.microsoft)
        throw new MailServiceError("NOT_AVAILABLE", "Microsoft mailboxes are not available here.");
      return createMicrosoftDriver({
        address: mailbox.address,
        transport: context.microsoft.transport(context.actor, mailbox.address),
      });
    }
    case "provisioned":
      throw new MailServiceError("NOT_AVAILABLE", "Provisioned mailboxes are not available yet.");
  }
};

/** The kinds that have a driver. A provisioned one is built by the service itself (it needs the message store), not by `defaultDriverFor`. */
export const DRIVER_KINDS: readonly MailboxKind[] = ["imap", "google", "microsoft", "provisioned"];

/** What the provisioned kind needs: the stored mail, the provider and the name that goes on a sent message. */
export type ProvisionedDeps = {
  messages: MessageStore;
  provider: () => Promise<MailProvider | undefined>;
  /** The bot's own name now, so a rename shows on the next mail sent. */
  displayName: (botId: string | null, fallback: string) => Promise<string>;
};

/**
 * What differs between the account kinds: the words of a mailbox whose account cannot be read (kept in the row, so the list shows them
 * before any read is tried) and of a refusal to show one again. Everything else about them is the same, so the code below looks a kind up
 * here instead of naming one.
 */
const ACCOUNT_WORDS = {
  google: {
    gone: "This Google account is not connected any more. Connect it again in Studio > Plugins > Google.",
    noRead:
      "Zetta was not given permission to read mail for this Google account. Open Studio > Plugins > Google, choose Change permissions, tick Gmail: read messages and sign in again.",
    notAvailable: "Google mailboxes are not available here.",
    noAccountCode: "NO_GOOGLE",
    noAccount:
      "That Google account is not connected with permission to read mail. Connect it in Studio > Plugins > Google.",
  },
  microsoft: {
    gone: "This Microsoft account is not connected any more. Connect it again in Studio > Plugins > Microsoft.",
    noRead:
      "Zetta was not given permission to read mail for this Microsoft account. Open Studio > Plugins > Microsoft, choose Change permissions, tick Mail: read messages and sign in again.",
    notAvailable: "Microsoft mailboxes are not available here.",
    noAccountCode: "NO_MICROSOFT",
    noAccount:
      "That Microsoft account is not connected with permission to read mail. Connect it in Studio > Plugins > Microsoft.",
  },
} as const satisfies Record<
  AccountKind,
  {
    gone: string;
    noRead: string;
    notAvailable: string;
    noAccountCode: "NO_GOOGLE" | "NO_MICROSOFT";
    noAccount: string;
  }
>;
/** What a plugin says of one connected account (the same for every kind). */
type AccountInfo = { email: string; connected: boolean; read: boolean; send: boolean };
const ACCOUNT_KINDS = Object.keys(ACCOUNT_WORDS) as AccountKind[];
export const isAccountKind = (k: MailboxKind): k is AccountKind => k in ACCOUNT_WORDS;

export const MAIL_PAGE = 30;

export type MailboxView = {
  id: string;
  kind: MailboxKind;
  address: string;
  label: string;
  state: MailboxState;
  lastError: string | null;
  sending: MailboxSending;
  ownerBotId: string | null;
  allowedSenders: string[];
  /** The servers and user name, for the edit form; never the password. */
  servers: Pick<
    MailboxConfig,
    "imapHost" | "imapPort" | "imapSecurity" | "smtpHost" | "smtpPort" | "smtpSecurity" | "user"
  >;
};

export type ServerSettings = Pick<
  MailboxConfig,
  "imapHost" | "imapPort" | "imapSecurity" | "smtpHost" | "smtpPort" | "smtpSecurity" | "user"
>;

export type ConnectInput = {
  address: string;
  label?: string;
  servers: Required<
    Pick<ServerSettings, "imapHost" | "imapPort" | "smtpHost" | "smtpPort" | "user">
  > &
    Pick<ServerSettings, "imapSecurity" | "smtpSecurity">;
  password: string;
  botId?: string | null;
  sending?: MailboxSending;
  allowedSenders?: string[];
};

export type UpdateInput = {
  label?: string;
  botId?: string | null;
  sending?: MailboxSending;
  allowedSenders?: string[];
  servers?: ServerSettings;
  password?: string;
};

export type MessageView = {
  id: string;
  origin: MailMessage["origin"];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: string | null;
  subject: string;
  text: string;
  /** Cleaned HTML for a sandboxed frame; empty when the message has none (or it was too long: see `htmlSize`). */
  html: string;
  htmlSize: HtmlSize;
  remoteImages: RemoteImages;
  attachments: {
    id: string;
    fileName: string;
    contentType: string;
    size: number;
    disposition: "attachment" | "inline";
  }[];
  source: MailMessage["source"];
};
/** What a reply needs, worked out on the server from the message being answered: the bot never gives an address or a subject. */
export type ReplyPlan = {
  /** The one recipient: the answered message's Reply-To, else its From. Lower case. */
  to: string;
  subject: string;
  /** The opaque id of the answered message: pass it as `inReplyTo` to `send`. */
  answers: string;
  /** The people who wrote the conversation (not the mailbox's own address): From and Reply-To of each of their messages. Lower case. */
  authors: string[];
  /** Every other address of the conversation (To and Cc), the mailbox's own left out. Lower case. */
  participants: string[];
  /** The recipient came from a Reply-To that is not the sender's own address. */
  replyToDiffers: boolean;
};
export type ConversationView = { id: string; subject: string; messages: MessageView[] };

/** A message as plain text, for a reader that is not a page (a bot): no HTML, and the files are only named. */
export type TextMessageView = {
  origin: MailMessage["origin"];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: string | null;
  subject: string;
  /** The text part, or the words of the HTML part when the message has no text part. */
  text: string;
  /** The files a person would open; an image shown inside the text is not listed. */
  files: { fileName: string; contentType: string; size: number }[];
  source: MailMessage["source"];
};
export type TextConversationView = { id: string; subject: string; messages: TextMessageView[] };

const view = (m: Mailbox): MailboxView => {
  const { imapHost, imapPort, imapSecurity, smtpHost, smtpPort, smtpSecurity, user } = m.config;
  return {
    id: m.id,
    kind: m.kind,
    address: m.address,
    label: m.label,
    state: m.state,
    lastError: m.lastError,
    sending: m.sending,
    ownerBotId: m.botId,
    allowedSenders: m.allowedSenders,
    servers: { imapHost, imapPort, imapSecurity, smtpHost, smtpPort, smtpSecurity, user },
  };
};

const cidOf = (c: string) => c.trim().replace(/^<|>$/g, "").toLowerCase();

/**
 * The other people of a conversation: the mailbox's own address is left out, unless it is the only one (mail the person sent to
 * themselves). It is done here, not in a driver, so every driver reads the same.
 */
export const othersOf = (participants: readonly MailAddress[], own: string): MailAddress[] => {
  const me = own.trim().toLowerCase();
  const others = participants.filter((p) => p.address.trim().toLowerCase() !== me);
  return others.length ? others : [...participants];
};

/** What a failed read says about the mailbox: the credentials are no good, or the server cannot be reached. Anything else is the caller's mistake. */
const stateFor = (e: MailConnectError): MailboxState | undefined =>
  e.code === "AUTH"
    ? "needs_auth"
    : ["UNREACHABLE", "TIMEOUT", "BLOCKED_URL", "MAIL_ERROR"].includes(e.code)
      ? "error"
      : undefined;

export function createMailService(deps: {
  store: MailboxStore;
  secrets: MailSecrets;
  /** Replaceable so a test needs no mail server. */
  driverFor?: DriverFactory;
  /** Closes the kept connection of a mailbox (the IMAP pool); replaceable for tests. */
  closeConnection?: (mailboxId: string) => Promise<void>;
  /** The person's Google connection; without it a Google mailbox is neither made nor read. */
  google?: GoogleMailAccess;
  /** The person's Microsoft connection; without it a Microsoft mailbox is neither made nor read. */
  microsoft?: MicrosoftMailAccess;
  /** Provisioned mailboxes (bot addresses); without it that kind is not available. */
  provisioned?: ProvisionedDeps;
}) {
  const { store, secrets, google, microsoft, provisioned } = deps;
  /** The person's connection of an account kind, or undefined when this server has none. */
  const accessOf = (
    kind: AccountKind,
  ): { accounts(a: ActiveActor): Promise<AccountInfo[]> } | undefined =>
    kind === "google" ? google : microsoft;
  const driverFor = deps.driverFor ?? defaultDriverFor;
  const closeConnection = deps.closeConnection ?? closeImapMailbox;

  /** Reads the sealed password for one use: the buffer is zeroed as soon as it is text. */
  async function passwordOf(a: ActiveActor, m: Mailbox) {
    if (!m.connectionId)
      throw new MailServiceError(
        "NO_PASSWORD",
        "The saved password of this mailbox is gone. Enter it again.",
      );
    const buf = await secrets.secretFor(a, m.connectionId).catch(() => undefined);
    if (!buf)
      throw new MailServiceError(
        "NO_PASSWORD",
        "The saved password of this mailbox is gone. Enter it again.",
      );
    const text = buf.toString("utf8");
    buf.fill(0);
    return text;
  }

  async function revokeQuietly(a: ActiveActor, id: string) {
    try {
      const c = (await secrets.list(a)).find((x) => x.id === id);
      if (c) await secrets.revoke(a, id, c.revision);
    } catch {
      /* an already revoked secret is fine */
    }
  }

  /** Records what a driver failure or success says about the mailbox; the stored sentence is the safe one, never the server's own. */
  async function record(a: ActiveActor, m: Mailbox, state: MailboxState, lastError: string | null) {
    if (m.state === "retired") return;
    if (m.state === state && m.lastError === lastError) return;
    await store.update(a, m.id, { state, lastError }).catch(() => undefined);
  }

  /** Runs `work` against the mailbox's driver and keeps the mailbox's state in step with the outcome. */
  async function withDriver<T>(
    a: ActiveActor,
    id: string,
    work: (d: MailboxDriver, m: Mailbox) => Promise<T>,
  ) {
    const m = await store.get(a, id);
    // The mail of a provisioned mailbox whose bot was archived stays readable (it is stored here); everything else retired is gone.
    if (m.state === "retired" && m.kind !== "provisioned")
      throw new MailServiceError("RETIRED", "This mailbox was retired.");
    if (!DRIVER_KINDS.includes(m.kind) || (m.kind === "provisioned" && !provisioned))
      throw new MailServiceError("NOT_AVAILABLE", "This kind of mailbox is not available yet.");
    if (m.kind === "provisioned") {
      const driver = createProvisionedDriver({
        mailbox: { id: m.id, address: m.address },
        messages: provisioned!.messages,
        provider: provisioned!.provider,
        displayName: () => provisioned!.displayName(m.botId, m.label || m.address),
      });
      return work(driver, m);
    }
    let password = "";
    // An account mailbox has no password: its token is borrowed from the plugin for each request.
    if (!isAccountKind(m.kind))
      try {
        password = await passwordOf(a, m);
      } catch (e) {
        if (e instanceof MailServiceError && e.code === "NO_PASSWORD")
          await record(a, m, "needs_auth", e.message);
        throw e;
      }
    const driver = driverFor(m, password, {
      actor: a,
      ...(google ? { google } : {}),
      ...(microsoft ? { microsoft } : {}),
    });
    try {
      const out = await work(driver, m);
      await record(a, m, "active", null);
      return out;
    } catch (e) {
      if (e instanceof MailConnectError) {
        const s = stateFor(e);
        if (s) await record(a, m, s, e.safe);
      }
      throw e;
    }
  }

  /** Proves settings that are not saved yet work; the temporary connection is closed either way. */
  async function prove(
    kind: MailboxKind,
    address: string,
    config: MailboxConfig,
    password: string,
  ) {
    const tmp = uuidv7();
    try {
      await driverFor({ id: tmp, kind, address, config }, password).check();
    } finally {
      await closeConnection(tmp).catch(() => undefined);
    }
  }

  const configOf = (s: ConnectInput["servers"] | ServerSettings): MailboxConfig =>
    Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as MailboxConfig;

  /**
   * The person's mailboxes, with each connected account (Google, Microsoft) that can read mail among them (made on first need, never
   * twice: see `MailboxStore.ensureAccount`). An account row is also kept in step with its account: one that is gone, or has lost the read
   * permission, shows `needs_auth` at once, and one that works again is active again. A row the person removed (`retired`) stays hidden
   * while its account is connected, and is dropped when the account is disconnected, so connecting it again brings it back.
   * When a plugin cannot be read at all, the rows of its kind are left as they are.
   */
  async function rows(a: ActiveActor): Promise<Mailbox[]> {
    const own = await store.list(a);
    const synced = new Map<AccountKind, Map<string, AccountInfo>>();
    for (const kind of ACCOUNT_KINDS) {
      const access = accessOf(kind);
      if (!access) continue;
      try {
        const accounts = await access.accounts(a);
        synced.set(kind, new Map(accounts.map((x) => [x.email.toLowerCase(), x])));
      } catch {
        /* this plugin cannot be read now: its rows stay as they are */
      }
    }
    if (!synced.size) return own;
    const out: Mailbox[] = [];
    for (const row of own) {
      const byEmail = isAccountKind(row.kind) ? synced.get(row.kind) : undefined;
      if (!byEmail) {
        out.push(row);
        continue;
      }
      const words = ACCOUNT_WORDS[row.kind as AccountKind];
      const acc = byEmail.get(row.address.toLowerCase());
      if (row.state === "retired") {
        if (acc) out.push(row);
        else await store.delete(a, row.id).catch(() => undefined);
        continue;
      }
      let next = row;
      if (acc?.read) {
        if (row.state === "needs_auth")
          next = await store.update(a, row.id, { state: "active" }).catch(() => row);
      } else {
        const why = acc?.connected ? words.noRead : words.gone;
        if (row.state !== "needs_auth" || row.lastError !== why)
          next = await store
            .update(a, row.id, { state: "needs_auth", lastError: why })
            .catch(() => row);
      }
      out.push(next);
    }
    for (const [kind, byEmail] of synced) {
      const have = new Set(own.filter((r) => r.kind === kind).map((r) => r.address.toLowerCase()));
      for (const acc of byEmail.values()) {
        if (!acc.read || have.has(acc.email.toLowerCase())) continue;
        try {
          // Sending starts off: nobody chose it for an address that appeared by itself. The person turns it on in the mailbox settings.
          out.push(await store.ensureAccount(a, kind, acc.email, { sending: "off" }));
        } catch {
          /* the next list tries again */
        }
      }
    }
    return out.sort(
      (x, y) => x.createdAt.getTime() - y.createdAt.getTime() || (x.id < y.id ? -1 : 1),
    );
  }

  return {
    /** Every mailbox row of the person, Google accounts included, for the callers that read a row themselves (the bots' plugin, the MCP server). */
    rows,

    list: async (a: ActiveActor) =>
      (await rows(a)).filter((m) => m.state !== "retired" || m.kind === "provisioned").map(view),

    /**
     * Shows a connected account (Google, Microsoft) as a mailbox again after the person removed it. The account must be connected with the
     * read permission; the row is the same one, so its name, bot and settings come back with it.
     */
    async showAccount(a: ActiveActor, kind: AccountKind, address: string): Promise<MailboxView> {
      const words = ACCOUNT_WORDS[kind];
      const access = accessOf(kind);
      if (!access) throw new MailServiceError("NOT_AVAILABLE", words.notAvailable);
      const want = address.trim().toLowerCase();
      const acc = (await access.accounts(a)).find((x) => x.email.toLowerCase() === want);
      if (!acc?.read) throw new MailServiceError(words.noAccountCode, words.noAccount);
      let row = await store.ensureAccount(a, kind, acc.email, { sending: "off" });
      if (row.state === "retired") row = await store.update(a, row.id, { state: "active" });
      return view(row);
    },

    /** Checks the servers and the password first: nothing is saved when it fails. */
    async connect(a: ActiveActor, v: ConnectInput): Promise<MailboxView> {
      const config = configOf(v.servers);
      await prove("imap", v.address, config, v.password);
      const saved = await secrets.create(a, {
        provider: "mailbox",
        label: `mailbox:${v.address.slice(0, 90)}`,
        secret: v.password,
      });
      try {
        const row = await store.create(a, {
          kind: "imap",
          address: v.address,
          ...(v.label !== undefined ? { label: v.label } : {}),
          botId: v.botId ?? null,
          connectionId: saved.id,
          config,
          ...(v.allowedSenders ? { allowedSenders: v.allowedSenders } : {}),
          ...(v.sending ? { sending: v.sending } : {}),
        });
        return view(row);
      } catch (e) {
        await revokeQuietly(a, saved.id);
        throw e;
      }
    },

    async update(a: ActiveActor, id: string, p: UpdateInput): Promise<MailboxView> {
      const current = await store.get(a, id);
      if (current.kind === "provisioned") {
        // The owner of an address handed to a bot is that bot, and the address and servers are the installation's.
        if (p.botId !== undefined && p.botId !== current.botId)
          throw new MailServiceError("BAD_INPUT", "The address of a bot belongs to that bot.");
        if (p.allowedSenders?.some((x) => !SENDER_PATTERN.test(x.trim().toLowerCase())))
          throw new MailServiceError(
            "BAD_INPUT",
            "Allowed senders are addresses (ana@example.com) or domains (@example.com).",
          );
      }
      const patch: Parameters<MailboxStore["update"]>[2] = {};
      if (p.label !== undefined) patch.label = p.label;
      if (p.botId !== undefined) patch.botId = p.botId;
      if (p.sending !== undefined) patch.sending = p.sending;
      if (p.allowedSenders !== undefined) patch.allowedSenders = p.allowedSenders;
      let created: string | undefined;
      const changesAccess =
        p.password !== undefined || (p.servers && Object.keys(p.servers).length > 0);
      if (changesAccess) {
        if (current.kind !== "imap")
          throw new MailServiceError(
            "NOT_AVAILABLE",
            "The servers of this kind of mailbox cannot be edited.",
          );
        const config = { ...current.config, ...configOf(p.servers ?? {}) };
        const password = p.password ?? (await passwordOf(a, current));
        await prove(current.kind, current.address, config, password);
        patch.config = config;
        patch.state = "active";
        if (p.password !== undefined) {
          created = (
            await secrets.create(a, {
              provider: "mailbox",
              label: `mailbox:${current.address.slice(0, 90)}`,
              secret: p.password,
            })
          ).id;
          patch.connectionId = created;
        }
      }
      try {
        const row = await store.update(a, id, patch);
        if (changesAccess) {
          await closeConnection(id).catch(() => undefined);
          if (created && current.connectionId) await revokeQuietly(a, current.connectionId);
        }
        return view(row);
      } catch (e) {
        if (created) await revokeQuietly(a, created);
        throw e;
      }
    },

    /**
     * Removes the mailbox, its sealed password and its kept connection. An account mailbox (Google, Microsoft) has neither: removing it
     * hides it (the row is kept as `retired`, so it does not come back on the next list) and leaves the account connected in the plugin,
     * which is where it is disconnected.
     */
    async remove(a: ActiveActor, id: string) {
      const m = await store.get(a, id);
      if (m.kind === "provisioned") {
        await store.removeProvisioned(a, id);
        return;
      }
      if (isAccountKind(m.kind)) {
        await store.update(a, id, { state: "retired", lastError: null });
        return;
      }
      await store.delete(a, id);
      await closeConnection(id).catch(() => undefined);
      if (m.connectionId) await revokeQuietly(a, m.connectionId);
    },

    conversations: (
      a: ActiveActor,
      id: string,
      q: { query?: string; cursor?: string; limit?: number },
    ): Promise<ConversationPage> =>
      withDriver(a, id, async (d, m) => {
        const page = await d.listConversations({
          limit: Math.max(1, Math.min(MAIL_PAGE, Math.floor(q.limit ?? MAIL_PAGE) || MAIL_PAGE)),
          ...(q.query ? { query: q.query } : {}),
          ...(q.cursor ? { cursor: q.cursor } : {}),
        });
        return {
          ...page,
          conversations: page.conversations.map((c) => ({
            ...c,
            participants: othersOf(c.participants, m.address),
          })),
        };
      }),

    /** The messages with cleaned HTML: `htmlUnsafe` never leaves this function. */
    conversation: (
      a: ActiveActor,
      id: string,
      cid: string,
      images: ImageMode,
    ): Promise<ConversationView> =>
      withDriver(a, id, async (d) => {
        const c = await d.getConversation(cid);
        const messages: MessageView[] = [];
        for (const m of c.messages) {
          const inline = await inlineParts(d, cid, m);
          const s = sanitizeMailHtml(m.htmlUnsafe, { images, inline });
          messages.push({
            id: m.id,
            origin: m.origin,
            from: m.from,
            to: m.to,
            cc: m.cc,
            date: m.date,
            subject: m.subject,
            text: m.text,
            html: s.html,
            htmlSize: s.size,
            remoteImages: s.remoteImages,
            attachments: m.attachments.map((x) => ({
              id: x.id,
              fileName: x.fileName,
              contentType: x.contentType,
              size: x.size,
              disposition: x.disposition,
            })),
            source: m.source,
          });
        }
        return { id: c.id, subject: c.subject, messages };
      }),

    /** The conversation as plain text. Nothing is cleaned or inlined and no file is read: only the message sources the driver already parsed. */
    conversationText: (a: ActiveActor, id: string, cid: string): Promise<TextConversationView> =>
      withDriver(a, id, async (d) => {
        const c = await d.getConversation(cid);
        return {
          id: c.id,
          subject: c.subject,
          messages: c.messages.map((m) => ({
            origin: m.origin,
            from: m.from,
            to: m.to,
            cc: m.cc,
            date: m.date,
            subject: m.subject,
            text: m.text.trim() ? m.text : htmlToText(m.htmlUnsafe),
            files: m.attachments
              .filter((x) => x.disposition === "attachment")
              .map((x) => ({ fileName: x.fileName, contentType: x.contentType, size: x.size })),
            source: m.source,
          })),
        };
      }),

    attachment: (a: ActiveActor, id: string, cid: string, aid: string): Promise<AttachmentBytes> =>
      withDriver(a, id, (d) => d.getAttachment(cid, aid)),

    /**
     * Who a reply goes to and what it is called, from the message being answered. `answer` is that message's number in the conversation
     * (1 is the oldest, as `mail_read` numbers them) or its opaque id; absent, it is the latest message the mailbox's owner did not write.
     */
    prepareReply: (
      a: ActiveActor,
      id: string,
      cid: string,
      answer?: string | number,
    ): Promise<ReplyPlan> =>
      withDriver(a, id, async (d, m) => {
        const c = await d.getConversation(cid);
        const own = m.address.trim().toLowerCase();
        const mine = (x: MailMessage) =>
          x.origin === "sent" || x.from?.address.trim().toLowerCase() === own;
        const wanted =
          answer === undefined || answer === ""
            ? c.messages.filter((x) => !mine(x)).at(-1)
            : (c.messages.find((x) => x.id === String(answer)) ??
              (/^\d{1,3}$/.test(String(answer)) ? c.messages[Number(answer) - 1] : undefined));
        if (!wanted)
          throw new MailServiceError("BAD_INPUT", "There is no such message to answer here.");
        if (mine(wanted))
          throw new MailServiceError(
            "BAD_INPUT",
            "That message was written by the mailbox's owner; answer one written by someone else.",
          );
        const low = (v: string | undefined) => (v ?? "").trim().toLowerCase();
        const from = low(wanted.from?.address);
        const reply = low(wanted.replyTo[0]?.address);
        const to = reply || from;
        if (!to) throw new MailServiceError("BAD_INPUT", "That message has no address to answer.");
        const others = c.messages.filter((x) => !mine(x));
        const authors = [
          ...new Set(
            others.flatMap((x) => [low(x.from?.address), ...x.replyTo.map((r) => low(r.address))]),
          ),
        ].filter(Boolean);
        const participants = [
          ...new Set(
            c.messages.flatMap((x) => [x.from, ...x.to, ...x.cc].map((p) => low(p?.address))),
          ),
        ].filter((x) => x && x !== own);
        const base = (wanted.subject || c.subject || "").trim();
        return {
          to,
          subject: /^(re|res|aw|sv)\s*:/i.test(base) ? base : `Re: ${base}`.trim(),
          answers: wanted.id,
          authors,
          participants,
          replyToDiffers: Boolean(reply) && reply !== from,
        };
      }),

    /** Sends one mail from the mailbox, only when the person left sending on for it. The caller (the mailbox plugin) has decided it may go. */
    send: (a: ActiveActor, id: string, mail: OutgoingMail): Promise<SentMail> =>
      withDriver(a, id, async (d, m) => {
        if (m.state === "retired")
          throw new MailServiceError("RETIRED", "This address was retired with its bot.");
        if (m.sending !== "on")
          throw new MailServiceError("SENDING_OFF", "Sending is off for this mailbox.");
        return d.send(mail);
      }),
  };
}
export type MailService = ReturnType<typeof createMailService>;

/**
 * The inline parts the message's HTML points to by `cid:`, read from the same message, within the sanitiser's limits; a part that fails is
 * skipped. The driver reads the message's source once for all of them.
 */
async function inlineParts(d: MailboxDriver, conversationId: string, m: MailMessage) {
  const out = new Map<string, InlinePart>();
  if (!m.htmlUnsafe) return out;
  const wanted = referencedCids(m.htmlUnsafe);
  if (!wanted.length) return out;
  let budget = SANITIZE_LIMITS.inlineTotalBytes;
  const chosen: { cid: string; id: string }[] = [];
  const taken = new Set<string>();
  for (const att of m.attachments) {
    const cid = cidOf(att.contentId);
    if (!cid || !wanted.includes(cid) || taken.has(cid)) continue;
    if (att.size > SANITIZE_LIMITS.inlineImageBytes || att.size > budget) continue;
    budget -= att.size;
    taken.add(cid);
    chosen.push({ cid, id: att.id });
  }
  if (!chosen.length) return out;
  let files: Map<string, { contentType: string; bytes: Uint8Array }>;
  try {
    files = await d.getAttachments(
      conversationId,
      chosen.map((c) => c.id),
    );
  } catch {
    return out; // the images are left out
  }
  let used = 0;
  for (const { cid, id } of chosen) {
    const file = files.get(id);
    if (
      !file ||
      !imageTypeOf(file.bytes) ||
      used + file.bytes.length > SANITIZE_LIMITS.inlineTotalBytes
    )
      continue;
    used += file.bytes.length;
    out.set(cid, { contentType: file.contentType, bytes: file.bytes });
  }
  return out;
}
