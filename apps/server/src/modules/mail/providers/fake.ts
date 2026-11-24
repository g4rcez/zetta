/** A provider that lives in memory, for tests: received mail is put in with `receive`, sent mail is kept in `sent`. */
import MailComposer from "nodemailer/lib/mail-composer";
import { MailConnectError } from "../imap-connect";
import type {
  Authentication,
  DomainStatus,
  MailProvider,
  PollResult,
  ProviderMail,
  RawMessage,
} from "./provider";

export type FakeReceived = {
  ref: string;
  recipients: string[];
  raw: Uint8Array;
  authentication: Authentication;
  receivedAt: string;
};

export type FakeProvider = MailProvider & {
  /** Newest last. */
  inbox: FakeReceived[];
  sent: { mail: ProviderMail; raw: Uint8Array }[];
  domain: DomainStatus;
  /** Calls made, by name, for a test that counts downloads. */
  calls: { poll: number; fetchRaw: number; send: number };
  /** Makes the next poll or download wait this long. */
  delayMs: number;
  /** Makes the next call of this kind fail. */
  failNext: "poll" | "fetchRaw" | "send" | null;
  /** Puts a message in the inbox; returns its ref. */
  receive(m: {
    to: string[];
    from: string;
    subject: string;
    text: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
    headers?: Record<string, string>;
    authentication?: Partial<Authentication>;
    ref?: string;
    attachment?: { filename: string; content: string };
  }): Promise<string>;
};

let counter = 0;

export function createFakeProvider(): FakeProvider {
  const p: FakeProvider = {
    inbox: [],
    sent: [],
    domain: { found: true, state: "verified", sending: true, receiving: true, records: [] },
    calls: { poll: 0, fetchRaw: 0, send: 0 },
    delayMs: 0,
    failNext: null,
    async receive(m) {
      const ref = m.ref ?? `fake-${++counter}`;
      const raw = await new MailComposer({
        from: m.from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        messageId: `<${m.messageId ?? `${ref}@sender.example.invalid`}>`,
        date: new Date(),
        ...(m.inReplyTo ? { inReplyTo: `<${m.inReplyTo}>` } : {}),
        ...(m.references?.length ? { references: m.references.map((r) => `<${r}>`) } : {}),
        ...(m.headers ? { headers: m.headers } : {}),
        ...(m.attachment ? { attachments: [m.attachment] } : {}),
      })
        .compile()
        .build();
      p.inbox.push({
        ref,
        recipients: m.to.map((t) => t.toLowerCase()),
        raw: new Uint8Array(raw),
        authentication: { spf: "pass", dkim: "pass", dmarc: "pass", ...m.authentication },
        receivedAt: new Date().toISOString(),
      });
      return ref;
    },
    async domainStatus() {
      return p.domain;
    },
    async poll(cursor, limit): Promise<PollResult> {
      p.calls.poll++;
      if (p.delayMs) await new Promise((r) => setTimeout(r, p.delayMs));
      if (p.failNext === "poll") {
        p.failNext = null;
        throw new MailConnectError("UNREACHABLE", "The mail provider could not be reached.");
      }
      const at = cursor ? p.inbox.findIndex((m) => m.ref === cursor) : -1;
      const fresh = cursor === null ? p.inbox.slice(-limit) : p.inbox.slice(at + 1);
      const page = fresh.slice(0, limit);
      return {
        items: page.map((m) => ({
          ref: m.ref,
          recipients: m.recipients,
          receivedAt: m.receivedAt,
        })),
        cursor: page.length ? page[page.length - 1]!.ref : cursor,
        more: cursor !== null && fresh.length > page.length,
      };
    },
    async fetchRaw(ref): Promise<RawMessage> {
      p.calls.fetchRaw++;
      if (p.delayMs) await new Promise((r) => setTimeout(r, p.delayMs));
      if (p.failNext === "fetchRaw") {
        p.failNext = null;
        throw new MailConnectError("UNREACHABLE", "The mail provider could not be reached.");
      }
      const m = p.inbox.find((x) => x.ref === ref);
      if (!m) throw new MailConnectError("NOT_FOUND", "The provider has no such mail.");
      return { raw: m.raw, authentication: m.authentication };
    },
    async send(mail) {
      p.calls.send++;
      if (p.failNext === "send") {
        p.failNext = null;
        throw new MailConnectError("MAIL_ERROR", "The mail provider refused to send the message.");
      }
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
      p.sent.push({ mail, raw: new Uint8Array(raw) });
      return { raw: new Uint8Array(raw) };
    },
  };
  return p;
}
