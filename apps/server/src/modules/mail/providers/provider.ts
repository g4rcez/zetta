/**
 * What the mail service that hands out bot addresses must do, whatever sits behind it. `resend.ts` is the first one; the fake in
 * `fake.ts` serves the tests. Receiving is polled (it works on an installation the internet cannot reach); sending goes out by SMTP
 * through the provider, so the threading headers are exactly the ones Zetta wrote.
 *
 * Every failure is a `MailConnectError` (`imap-connect.ts`): a stable code and a sentence the person can read, never the provider's own
 * words. No call carries the key anywhere but in the one header or password the provider asks for.
 */

/** One DNS record the administrator adds at the domain's DNS host, as the provider shows it. */
export type DnsRecord = {
  /** What the record is for: `SPF`, `DKIM`, `MX`... as the provider names it. */
  purpose: string;
  type: string;
  /** The host name, as the provider writes it (relative to the domain). */
  name: string;
  value: string;
  priority?: number;
  /** Whether the provider has seen the record in DNS. */
  verified: boolean;
};

export type DomainStatus =
  | { found: false }
  | {
      found: true;
      /** The provider's own word for the state of the domain (`verified`, `pending`...). */
      state: string;
      /** The domain can send mail. */
      sending: boolean;
      /** The domain can receive mail. */
      receiving: boolean;
      records: DnsRecord[];
    };

/** What the provider says of a received message's sender: each is `pass`, `fail`... or `unknown`. */
export type Authentication = { spf: string; dkim: string; dmarc: string };

/** A received message as the list shows it, before its source is downloaded. */
export type ReceivedItem = {
  /** The provider's id: unique and stable, so a replayed poll never stores a message twice. */
  ref: string;
  /** Every address it was sent to (To, Cc and Bcc), lower case. */
  recipients: string[];
  /** ISO time the provider received it. */
  receivedAt: string;
};

export type PollResult = {
  /** Oldest first. */
  items: ReceivedItem[];
  /** Where the next poll starts; the caller keeps it only after it stored what `items` holds. */
  cursor: string | null;
  /** More mail waited than one call returns: poll again soon. */
  more: boolean;
};

export type RawMessage = {
  /** The whole message as sent over the wire (headers, body, attachments). */
  raw: Uint8Array;
  authentication: Authentication;
};

export type ProviderMail = {
  /** The sender, as the address of the bot's own mailbox with its display name. */
  from: { name: string; address: string };
  to: string[];
  subject: string;
  text: string;
  /** Without angle brackets. */
  messageId: string;
  /** Without angle brackets. */
  inReplyTo?: string;
  references?: string[];
};

export interface MailProvider {
  /** Reads the domain: whether it exists at the provider, can send and receive, and the DNS records still to add. */
  domainStatus(domain: string): Promise<DomainStatus>;
  /** The mail that arrived after `cursor` (null: the newest the provider holds). Nothing is marked or removed at the provider. */
  poll(cursor: string | null, limit: number): Promise<PollResult>;
  /** The source of one received message, and what the provider says of its sender. */
  fetchRaw(ref: string): Promise<RawMessage>;
  /** Sends one message; the stored copy is the caller's. Returns the exact source it sent, so the copy is the same bytes. */
  send(mail: ProviderMail): Promise<{ raw: Uint8Array }>;
}

/** The most a stored or downloaded message source may hold. */
export const RAW_LIMIT = 15 * 1024 * 1024;
