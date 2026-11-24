/**
 * One message's source as the shape the driver hands out (`driver.ts`), through `mailparser`. Nothing here touches a mailbox.
 * Inline `cid:` parts are described, never inlined: turning them into something a page can show belongs to the sanitiser step.
 */
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type {
  AttachmentInfo,
  MailAddress,
  MailMessage,
  MessageOrigin,
  MessageSource,
} from "./driver";
import { parseMessageIds } from "./threading";

export const PARSE_LIMITS = {
  /** Characters of plain text kept per message. */
  text: 100_000,
  /** Characters of HTML kept per message. */
  html: 400_000,
  subject: 998,
  fileName: 200,
  attachments: 100,
  recipients: 100,
} as const;

/** The three threading headers of a header block (`Message-ID`, `In-Reply-To`, `References`), unfolded. */
export function parseThreadHeaders(block: Uint8Array | string | undefined) {
  const text = typeof block === "string" ? block : Buffer.from(block ?? []).toString("utf8");
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  const get = (name: string) => {
    const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(unfolded);
    return m ? m[1]! : "";
  };
  return {
    messageId: parseMessageIds(get("message-id"))[0] ?? "",
    inReplyTo: parseMessageIds(get("in-reply-to")),
    references: parseMessageIds(get("references")),
  };
}

/** Whether a character is a control character or a Unicode line separator: none belongs in a header value or a title. */
export const isControl = (ch: string) => {
  const c = ch.charCodeAt(0);
  return c < 32 || c === 127 || c === 0x2028 || c === 0x2029;
};

/** One line of plain words: control characters become spaces, runs of space collapse, cut at `max` characters. */
export const oneLine = (s: unknown, max: number) =>
  Array.from(String(s ?? ""), (ch) => (isControl(ch) ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const addressesOf = (field: AddressObject | AddressObject[] | undefined): MailAddress[] => {
  const out: MailAddress[] = [];
  for (const f of Array.isArray(field) ? field : field ? [field] : [])
    for (const v of f.value ?? []) {
      const members = v.group?.length ? v.group : [v];
      for (const a of members) {
        const address = oneLine(a.address, 320).toLowerCase();
        if (address) out.push({ name: oneLine(a.name, 200), address });
      }
    }
  return out.slice(0, PARSE_LIMITS.recipients);
};

const WHEN = (d: Date | undefined) => (d && Number.isFinite(d.getTime()) ? d.toISOString() : null);

const parserOptions = {
  // `cid:` stays as the sender wrote it; the sanitiser decides what to do with it.
  skipImageLinks: true,
  skipTextToHtml: true,
  skipTextLinks: true,
} as const;

const inlineOf = (a: ParsedMail["attachments"][number]) =>
  Boolean(a.cid) && (a.contentDisposition === "inline" || a.related === true);

const describe = (
  id: string,
  a: ParsedMail["attachments"][number],
  index: number,
): AttachmentInfo => ({
  id: `${id}.${index}`,
  fileName:
    oneLine(a.filename, PARSE_LIMITS.fileName).replace(/[\\/]/g, "_") || `attachment-${index + 1}`,
  contentType: oneLine(a.contentType, 120).toLowerCase() || "application/octet-stream",
  size: Number.isFinite(a.size) ? a.size : (a.content?.length ?? 0),
  disposition: inlineOf(a) ? "inline" : "attachment",
  contentId: oneLine(a.cid, 300).replace(/^<|>$/g, ""),
});

/** Whether the attachment is one a person opens (not an image the HTML shows inside the text). */
export const isFileAttachment = (a: AttachmentInfo) => a.disposition === "attachment";

/**
 * A message source as a `MailMessage`. `truncated`: the source was cut at the size limit, so the text and the file list may be short.
 * A source that cannot be parsed gives an empty message marked `unreadable`, never an exception.
 */
export async function parseMessage(
  source: Uint8Array,
  o: { id: string; origin: MessageOrigin; truncated: boolean },
): Promise<MailMessage> {
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(Buffer.from(source), parserOptions);
  } catch {
    return unreadable(o);
  }
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const state: MessageSource = o.truncated ? "truncated" : "complete";
  const cut = text.length > PARSE_LIMITS.text || html.length > PARSE_LIMITS.html;
  return {
    id: o.id,
    messageId: parseMessageIds(String(parsed.messageId ?? ""))[0] ?? "",
    origin: o.origin,
    from: addressesOf(parsed.from)[0] ?? null,
    to: addressesOf(parsed.to),
    cc: addressesOf(parsed.cc),
    replyTo: addressesOf(parsed.replyTo),
    date: WHEN(parsed.date),
    subject: oneLine(parsed.subject, PARSE_LIMITS.subject),
    text: text.slice(0, PARSE_LIMITS.text),
    htmlUnsafe: html.slice(0, PARSE_LIMITS.html),
    attachments: (parsed.attachments ?? [])
      .slice(0, PARSE_LIMITS.attachments)
      .map((a, i) => describe(o.id, a, i)),
    source: cut ? "truncated" : state,
  };
}

const unreadable = (o: { id: string; origin: MessageOrigin }): MailMessage => ({
  id: o.id,
  messageId: "",
  origin: o.origin,
  from: null,
  to: [],
  cc: [],
  replyTo: [],
  date: null,
  subject: "",
  text: "",
  htmlUnsafe: "",
  attachments: [],
  source: "unreadable",
});

/** The bytes of one attachment of a message source (the index `parseMessage` described it with), or undefined. */
export async function extractAttachment(source: Uint8Array, index: number) {
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(Buffer.from(source), parserOptions);
  } catch {
    return undefined;
  }
  const a = parsed.attachments?.[index];
  if (!a) return undefined;
  const info = describe("x", a, index);
  return {
    fileName: info.fileName,
    contentType: info.contentType,
    bytes: new Uint8Array(a.content),
  };
}

/** Several attachments of one message source, parsed once; the map is keyed by the index `parseMessage` described each with. */
export async function extractAttachments(source: Uint8Array, indexes: number[]) {
  const out = new Map<number, { fileName: string; contentType: string; bytes: Uint8Array }>();
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(Buffer.from(source), parserOptions);
  } catch {
    return out;
  }
  for (const index of new Set(indexes)) {
    const a = parsed.attachments?.[index];
    if (!a) continue;
    const info = describe("x", a, index);
    out.set(index, {
      fileName: info.fileName,
      contentType: info.contentType,
      bytes: new Uint8Array(a.content),
    });
  }
  return out;
}
