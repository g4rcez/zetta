/**
 * Resend as the provider of bot addresses (https://resend.com/docs). Plain receiving, not its paid Inboxes product.
 *
 *   domain      GET  /domains (find by name), GET /domains/{id}: `status`, `capabilities.sending|receiving`, `records[]`
 *   list        GET  /emails/receiving?limit=&before=   newest first; `before` = items newer than that id
 *   one         GET  /emails/receiving/{id}             `authentication {spf,dkim,dmarc}`, `raw.download_url` (signed, expires)
 *   raw         GET  <raw.download_url>                 the original message, sent without the API key
 *   send        SMTP smtp.resend.com, user `resend`, password = the API key, so the threading headers are the ones Zetta wrote
 *
 * Every host goes through the mail module's address policy (`assertMailHosts`), every call has a timeout, and the answer of the
 * provider is read for what Zetta needs only; none of its own words reach a person.
 */
import MailComposer from "nodemailer/lib/mail-composer";
import { assertMailHosts, MailConnectError, mailFailure } from "../imap-connect";
import {
  RAW_LIMIT,
  type Authentication,
  type DnsRecord,
  type DomainStatus,
  type MailProvider,
  type PollResult,
  type ProviderMail,
  type RawMessage,
  type ReceivedItem,
} from "./provider";

export const RESEND_API = "https://api.resend.com";
export const RESEND_SMTP = { host: "smtp.resend.com", port: 465 } as const;

/** The smallest part of a `nodemailer` transport this file uses; a test hands in its own. */
export type SmtpTransport = {
  sendMail(m: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>;
  close(): void;
};

export type ResendOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Replaceable so a test can talk to a server on this machine. Default: the mail module's address policy. */
  assertHost?: (host: string) => Promise<void>;
  /** Builds the SMTP connection for one send. Default: `nodemailer`, TLS on port 465. */
  smtp?: (apiKey: string) => Promise<SmtpTransport>;
  timeoutMs?: number;
};

const dig = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** `Ana <ana@example.com>` and `ana@example.com` both give the address, lower case. */
export const addressOf = (v: unknown): string => {
  const s = str(v).trim();
  const angle = /<([^<>\s]+)>/.exec(s);
  return (angle ? angle[1]! : s).toLowerCase();
};

const AUTH_WORDS = new Set(["pass", "fail", "gray", "processing_failed", "unknown"]);
const word = (v: unknown) => (AUTH_WORDS.has(str(v)) ? str(v) : "unknown");

export function createResendProvider(o: ResendOptions): MailProvider {
  const base = (o.baseUrl ?? RESEND_API).replace(/\/+$/, "");
  const doFetch = o.fetch ?? fetch;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const assertHost = o.assertHost ?? ((h: string) => assertMailHosts([h]));

  async function request(url: string, opts: { auth: boolean; limit?: number }): Promise<Response> {
    const host = new URL(url).hostname;
    await assertHost(host);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          ...(opts.auth ? { authorization: `Bearer ${o.apiKey}` } : {}),
        },
      });
    } catch (e) {
      if (e instanceof MailConnectError) throw e;
      const name = (e as { name?: string })?.name;
      throw name === "TimeoutError" || name === "AbortError"
        ? new MailConnectError("TIMEOUT", "The mail provider took too long to answer.")
        : new MailConnectError("UNREACHABLE", "The mail provider could not be reached.");
    }
    if (res.ok) return res;
    // The body is never read: it is the provider's own words.
    if (res.status === 401 || res.status === 403)
      throw new MailConnectError(
        "AUTH",
        "The mail provider did not accept the saved key.",
        "Ask the administrator to save the key again in Studio > Plugins > Bot e-mail address.",
      );
    if (res.status === 404)
      throw new MailConnectError("NOT_FOUND", "The provider has no such mail.");
    if (res.status === 429)
      throw new MailConnectError("RATE_LIMITED", "The mail provider asked Zetta to slow down.");
    throw new MailConnectError("MAIL_ERROR", "The mail provider refused the request.");
  }
  const json = async (path: string, query: Record<string, string> = {}) => {
    const q = new URLSearchParams(query).toString();
    const res = await request(`${base}${path}${q ? `?${q}` : ""}`, { auth: true });
    try {
      return dig(await res.json());
    } catch {
      throw new MailConnectError(
        "MAIL_ERROR",
        "The mail provider gave an answer Zetta cannot read.",
      );
    }
  };

  async function domainStatus(domain: string): Promise<DomainStatus> {
    const want = domain.trim().toLowerCase();
    const list = await json("/domains");
    const hit = (Array.isArray(list.data) ? list.data : [])
      .map(dig)
      .find((d) => str(d.name).toLowerCase() === want);
    if (!hit || !str(hit.id)) return { found: false };
    const d = await json(`/domains/${encodeURIComponent(str(hit.id))}`);
    const caps = dig(d.capabilities);
    const records: DnsRecord[] = (Array.isArray(d.records) ? d.records : [])
      .slice(0, 30)
      .map((r) => {
        const x = dig(r);
        return {
          purpose: str(x.record),
          type: str(x.type),
          name: str(x.name),
          value: str(x.value),
          ...(typeof x.priority === "number" ? { priority: x.priority } : {}),
          verified: str(x.status) === "verified",
        };
      });
    return {
      found: true,
      state: str(d.status) || str(hit.status) || "unknown",
      sending: str(caps.sending) === "enabled",
      receiving: str(caps.receiving) === "enabled",
      records,
    };
  }

  async function poll(cursor: string | null, limit: number): Promise<PollResult> {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const page = await json("/emails/receiving", {
      limit: String(n),
      ...(cursor ? { before: cursor } : {}),
    });
    const rows = (Array.isArray(page.data) ? page.data : []).map(dig).filter((r) => str(r.id));
    const items: ReceivedItem[] = rows
      .map((r) => ({
        ref: str(r.id),
        recipients: [
          ...new Set(
            [r.to, r.cc, r.bcc]
              .flatMap((l) => (Array.isArray(l) ? l : []))
              .map(addressOf)
              .filter(Boolean),
          ),
        ],
        receivedAt: str(r.created_at),
      }))
      // The provider lists the newest first; the caller wants them in the order they arrived.
      .reverse();
    return {
      items,
      // The newest id seen is where the next poll starts. An empty answer leaves the cursor where it was.
      cursor: rows.length ? str(rows[0]!.id) : cursor,
      // With no cursor this is the first look: older mail is not wanted, so there is nothing more to fetch.
      more: cursor !== null && page.has_more === true,
    };
  }

  async function readLimited(res: Response): Promise<Uint8Array> {
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > RAW_LIMIT) throw tooLarge();
    const reader = res.body?.getReader();
    if (!reader) return new Uint8Array(await res.arrayBuffer());
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > RAW_LIMIT) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  const tooLarge = () => new MailConnectError("TOO_LARGE", "That message is too large to keep.");

  async function fetchRaw(ref: string): Promise<RawMessage> {
    const one = await json(`/emails/receiving/${encodeURIComponent(ref)}`, { html_format: "cid" });
    const raw = dig(one.raw);
    const url = str(raw.download_url);
    if (!url)
      throw new MailConnectError("NO_RAW", "The provider did not give the original message.");
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new MailConnectError("NO_RAW", "The provider did not give the original message.");
    }
    if (target.protocol !== "https:" && !o.baseUrl)
      throw new MailConnectError("NO_RAW", "The provider did not give the original message.");
    // A signed address: the key is not sent to it.
    const res = await request(target.toString(), { auth: false });
    const a = dig(one.authentication);
    const authentication: Authentication = {
      spf: word(a.spf),
      dkim: word(a.dkim),
      dmarc: word(a.dmarc),
    };
    return { raw: await readLimited(res), authentication };
  }

  async function send(mail: ProviderMail): Promise<{ raw: Uint8Array }> {
    const raw = await new MailComposer({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId: `<${mail.messageId}>`,
      date: new Date(),
      ...(mail.inReplyTo ? { inReplyTo: `<${mail.inReplyTo}>` } : {}),
      ...(mail.references?.length ? { references: mail.references.map((r) => `<${r}>`) } : {}),
    })
      .compile()
      .build();
    if (raw.length > RAW_LIMIT) throw tooLarge();
    try {
      await assertHost(RESEND_SMTP.host);
      const transport = await (o.smtp ?? defaultSmtp)(o.apiKey);
      try {
        await transport.sendMail({
          envelope: { from: mail.from.address, to: mail.to },
          raw,
        });
      } finally {
        transport.close();
      }
    } catch (e) {
      throw mailFailure(e, "send the message", "Ask the administrator to save the key again.");
    }
    return { raw: new Uint8Array(raw) };
  }

  return { domainStatus, poll, fetchRaw, send };
}

async function defaultSmtp(apiKey: string): Promise<SmtpTransport> {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({
    host: RESEND_SMTP.host,
    port: RESEND_SMTP.port,
    secure: true,
    auth: { user: "resend", pass: apiKey },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  }) as unknown as SmtpTransport;
}
