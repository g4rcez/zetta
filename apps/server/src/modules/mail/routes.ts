import { MAILBOX_SENDING } from "@zetta/db/schema/mail";
import { Elysia } from "elysia";
import { z } from "zod";
import { TransportError } from "@zetta/core/sealed-transport";
import { ConnectionsUnavailableError } from "../connections/service";
import {
  TransportKeyExpiredError,
  transportKeyring,
  type TransportKeyring,
} from "../connections/transport";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { MailConnectError, isMailHost } from "./imap-connect";
import { detectMailServers, systemResolver, type DnsResolver } from "./providers";
import { MailServiceError, type MailService } from "./service";
import { MailboxRuleError } from "./store";
import type { MailChatService } from "./chat";
import { ProvisionError, type Provisioning } from "./provision";

export type MailServices = {
  access: ReturnType<typeof createIdentityAccess>;
  mail: MailService;
  /** The chat of a mailbox; without it the route answers 501. */
  chat?: MailChatService;
  /** Replaceable so a test needs no network. */
  dns?: DnsResolver;
  /** Bot addresses; without it the routes for them answer 501. */
  provisioning?: Provisioning;
};

/** Requests per person per minute, by kind of work. Each of the first and third reaches out to a mail server or to DNS. */
export const MAIL_RATE = { connect: 10, detect: 30, attachment: 30 } as const;
const WINDOW_MS = 60_000;
class RateLimited extends Error {}

const uuid = z.string().uuid();
const opaque = z.string().min(1).max(4000);
const noControl = (s: string) =>
  !Array.from(s).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const host = z.string().trim().min(1).max(253).refine(isMailHost, "Not a server name.");
const port = z.number().int().min(1).max(65535);
const security = z.enum(["tls", "starttls"]);
const address = z
  .string()
  .trim()
  .max(320)
  .regex(/^[^\s<>@]+@[^\s<>@]+$/, "Not an e-mail address.");
const userName = z.string().trim().min(1).max(320).refine(noControl);
const label = z.string().trim().max(120);
const senders = z.array(z.string().trim().min(1).max(320)).max(200);
const sending = z.enum(MAILBOX_SENDING);

const connectBody = z.strictObject({
  address,
  label: label.optional(),
  imapHost: host,
  imapPort: port,
  imapSecurity: security.optional(),
  smtpHost: host,
  smtpPort: port,
  smtpSecurity: security.optional(),
  user: userName,
  botId: uuid.nullable().optional(),
  sending: sending.optional(),
  allowedSenders: senders.optional(),
  sealed: z.unknown(),
});
const accountBody = z.strictObject({ address });
const patchBody = z.strictObject({
  label: label.optional(),
  botId: uuid.nullable().optional(),
  sending: sending.optional(),
  allowedSenders: senders.optional(),
  imapHost: host.optional(),
  imapPort: port.optional(),
  imapSecurity: security.optional(),
  smtpHost: host.optional(),
  smtpPort: port.optional(),
  smtpSecurity: security.optional(),
  user: userName.optional(),
  sealed: z.unknown().optional(),
});
/** What the browser seals: the password and nothing else. A plaintext `password` beside it fails the strict schemas above. */
const sealedPassword = z.strictObject({ password: z.string().min(1).max(1000) });
const listQuery = z.object({
  q: z.string().max(200).optional(),
  cursor: z.string().max(2000).optional(),
});
const openQuery = z.object({ images: z.enum(["blocked", "remote"]).default("blocked") });

/** A file name that is safe in a `Content-Disposition` header: no path, no control character, no quote, bounded. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = Array.from(base)
    .map((c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '"\\;%<>:*?|'.includes(c) ? "_" : c,
    )
    .join("")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "attachment";
}
const attachmentHeaders = (name: string, size: number) => {
  const ascii = Array.from(name, (c) => (c.charCodeAt(0) > 126 ? "_" : c)).join("");
  return {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "cache-control": "no-store",
    "content-length": String(size),
  };
};

/** Every failure answers with a sentence the person can read; a mail server's own words never reach the answer. */
const CONNECT_STATUS: Record<string, number> = {
  AUTH: 422,
  BLOCKED_URL: 400,
  BAD_INPUT: 400,
  NO_MESSAGE_ID: 400,
  BAD_ID: 404,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SEND_SCOPE: 422,
};
const SERVICE_STATUS = {
  NOT_AVAILABLE: 501,
  NO_PASSWORD: 409,
  RETIRED: 409,
  BAD_INPUT: 400,
  SENDING_OFF: 409,
  NO_GOOGLE: 409,
  NO_MICROSOFT: 409,
} as const;
const RULE_STATUS = { BAD_ADDRESS: 400, ADDRESS_TAKEN: 409, BAD_REFERENCE: 400 } as const;

export function createMailRoutes(
  { access, mail, chat, dns = systemResolver, provisioning }: MailServices,
  trustedOrigins: readonly string[],
  keyring: TransportKeyring = transportKeyring,
) {
  const calls = new Map<string, number[]>();
  const limit = (kind: keyof typeof MAIL_RATE, userId: string) => {
    const key = `${kind}:${userId}`;
    const now = Date.now();
    const recent = (calls.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAIL_RATE[kind]) throw new RateLimited();
    calls.set(key, [...recent, now]);
  };

  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof RateLimited)
      return fail(429, "RATE_LIMITED", "Too many requests. Wait a minute and try again.");
    if (e instanceof MailConnectError)
      return fail(CONNECT_STATUS[e.code] ?? 502, e.code, e.safe, e.fix ? { fix: e.fix } : {});
    if (e instanceof MailServiceError) return fail(SERVICE_STATUS[e.code], e.code, e.message);
    if (e instanceof MailboxRuleError) return fail(RULE_STATUS[e.code], e.code, e.message);
    if (e instanceof ProvisionError)
      return fail(e.code === "NOT_A_BOT" ? 400 : 409, e.code, e.message);
    if (e instanceof ConnectionsUnavailableError)
      return fail(
        503,
        "CONNECTIONS_NOT_CONFIGURED",
        "Connections are not configured on this server. The administrator must set ZETTA_CONNECTION_KEY.",
      );
    if (e instanceof TransportKeyExpiredError)
      return fail(409, "TRANSPORT_KEY_EXPIRED", "The encryption key rotated. Try again.");
    if (e instanceof z.ZodError || e instanceof TransportError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }

  type Ctx = {
    actor: ActiveActor;
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
  };
  /** The guard every route shares: trusted origin for writes, an active person, and the error shapes above. The work may return a `Response` of its own. */
  const g =
    (work: (c: Ctx) => Promise<unknown>, status = 200) =>
    async ({
      request,
      body,
      params,
      query,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
      query: Record<string, string | undefined>;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        const actor = await access.requireActive(request.headers);
        const result = await work({ actor, body, params, query });
        return result instanceof Response ? result : out(result, status);
      } catch (e) {
        return mapError(e);
      }
    };

  const openPassword = async (c: Ctx, sealed: unknown, purpose: string) =>
    sealedPassword.parse(await keyring.open(sealed, { userId: c.actor.userId, purpose })).password;
  const servers = <T extends Record<string, unknown>>(b: T) => {
    const s = {
      imapHost: b.imapHost,
      imapPort: b.imapPort,
      imapSecurity: b.imapSecurity,
      smtpHost: b.smtpHost,
      smtpPort: b.smtpPort,
      smtpSecurity: b.smtpSecurity,
      user: b.user,
    };
    return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
  };

  return (
    new Elysia({ prefix: "/api", normalize: false })
      .get(
        "/mailboxes",
        g(async (c) => ({ mailboxes: await mail.list(c.actor) })),
      )
      // Whether this server hands out addresses to bots, and on which domain. Nothing secret; any signed-in person may ask.
      .get(
        "/mail/provisioning",
        g(async () => (provisioning ? await provisioning.offered() : { on: false, domain: "" })),
      )
      // "Give this bot an address": one address per bot of the person, made when the installation offers them.
      .post(
        "/mailboxes/provision",
        g(async (c) => {
          if (!provisioning)
            return fail(501, "NOT_AVAILABLE", "Bot addresses are not available here.");
          const { botId } = z.strictObject({ botId: uuid }).parse(c.body);
          limit("connect", c.actor.userId);
          const row = await provisioning.giveAddress(c.actor, botId);
          return { mailbox: (await mail.list(c.actor)).find((m) => m.id === row.id) };
        }, 201),
      )
      // A Google or Microsoft account the person connected in its plugin appears in the list by itself; these bring back one they removed.
      .post(
        "/mailboxes/google",
        g(async (c) => ({
          mailbox: await mail.showAccount(c.actor, "google", accountBody.parse(c.body).address),
        })),
      )
      .post(
        "/mailboxes/microsoft",
        g(async (c) => ({
          mailbox: await mail.showAccount(c.actor, "microsoft", accountBody.parse(c.body).address),
        })),
      )
      // The password arrives sealed to the server key (see @zetta/core/sealed-transport), like a plugin's credentials.
      .post(
        "/mailboxes",
        g(async (c) => {
          const b = connectBody.parse(c.body);
          limit("connect", c.actor.userId);
          const password = await openPassword(c, b.sealed, "mailbox.connect");
          return {
            mailbox: await mail.connect(c.actor, {
              address: b.address,
              ...(b.label !== undefined ? { label: b.label } : {}),
              servers: servers(b) as never,
              password,
              ...(b.botId !== undefined ? { botId: b.botId } : {}),
              ...(b.sending ? { sending: b.sending } : {}),
              ...(b.allowedSenders ? { allowedSenders: b.allowedSenders } : {}),
            }),
          };
        }, 201),
      )
      .patch(
        "/mailboxes/:id",
        g(async (c) => {
          const id = uuid.parse(c.params.id);
          const b = patchBody.parse(c.body);
          const s = servers(b);
          const changesAccess = b.sealed !== undefined || Object.keys(s).length > 0;
          if (changesAccess) limit("connect", c.actor.userId);
          const password =
            b.sealed !== undefined
              ? await openPassword(c, b.sealed, `mailbox.password:${id}`)
              : undefined;
          return {
            mailbox: await mail.update(c.actor, id, {
              ...(b.label !== undefined ? { label: b.label } : {}),
              ...(b.botId !== undefined ? { botId: b.botId } : {}),
              ...(b.sending ? { sending: b.sending } : {}),
              ...(b.allowedSenders ? { allowedSenders: b.allowedSenders } : {}),
              ...(Object.keys(s).length ? { servers: s } : {}),
              ...(password !== undefined ? { password } : {}),
            }),
          };
        }),
      )
      .delete(
        "/mailboxes/:id",
        g(async (c) => {
          await mail.remove(c.actor, uuid.parse(c.params.id));
          return { ok: true };
        }),
      )
      // The person's chat with the bot that owns this mailbox (their Chief when none does), made on first use.
      .post(
        "/mailboxes/:id/chat",
        g(async (c) => {
          const id = uuid.parse(c.params.id);
          if (!chat) return fail(501, "NOT_AVAILABLE", "Chat is not available on this server.");
          return { chat: await chat.chatFor(c.actor, id) };
        }),
      )
      .get(
        "/mailboxes/:id/conversations",
        g(async (c) => {
          const q = listQuery.parse(c.query);
          return mail.conversations(c.actor, uuid.parse(c.params.id), {
            ...(q.q?.trim() ? { query: q.q.trim() } : {}),
            ...(q.cursor ? { cursor: q.cursor } : {}),
          });
        }),
      )
      .get(
        "/mailboxes/:id/conversations/:cid",
        g(async (c) => ({
          conversation: await mail.conversation(
            c.actor,
            uuid.parse(c.params.id),
            opaque.parse(c.params.cid),
            openQuery.parse(c.query).images,
          ),
        })),
      )
      .get(
        "/mailboxes/:id/conversations/:cid/attachments/:aid",
        g(async (c) => {
          const id = uuid.parse(c.params.id);
          const cid = opaque.parse(c.params.cid);
          const aid = opaque.parse(c.params.aid);
          limit("attachment", c.actor.userId);
          const file = await mail.attachment(c.actor, id, cid, aid);
          return new Response(file.bytes, {
            headers: attachmentHeaders(safeFileName(file.fileName), file.bytes.length),
          });
        }),
      )
      .get(
        "/mail/detect",
        g(async (c) => {
          const a = z
            .string()
            .max(400)
            .parse(c.query.address ?? "");
          limit("detect", c.actor.userId);
          const found = await detectMailServers(a, dns);
          if (found.status === "invalid") return fail(400, "BAD_ADDRESS", found.message);
          if (found.status === "microsoft") {
            // Outlook and Microsoft 365 are read through the Microsoft plugin: point at the mailbox when the account is already connected.
            const have = (await mail.list(c.actor)).find(
              (m) => m.kind === "microsoft" && m.address.toLowerCase() === a.trim().toLowerCase(),
            );
            return {
              detection: {
                ...found,
                next: have
                  ? { type: "mailbox", mailboxId: have.id }
                  : { type: "plugin", pluginId: "microsoft" },
              },
            };
          }
          return { detection: found };
        }),
      )
  );
}
