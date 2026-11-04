import { parseLaunchJournal } from "./launch-journal";
import type { LaunchJournal } from "./launch-journal";
import type { FixtureLaunchPolicy } from "./launch-recipe";

export const JOURNAL_BYTE_LIMIT = 16_384;
export type JournalTrust = Readonly<{ policy: FixtureLaunchPolicy; receiptId: string }>;
export class JournalCodecError extends Error {
  readonly name = "JournalCodecError";
  constructor() {
    super("invalid_journal_bytes");
  }
}

// Version1 disk ordering is defined by parseLaunchJournal, not caller key order.
// Historical decoding confers neither fresh admission nor execution authority.
export function encodeJournal(raw: unknown, trusted: JournalTrust): Buffer<ArrayBuffer> {
  try {
    const bytes = Buffer.from(JSON.stringify(parseLaunchJournal(raw, trusted)) + "\n", "utf8");
    if (bytes.length > JOURNAL_BYTE_LIMIT) throw new JournalCodecError();
    return bytes;
  } catch {
    throw new JournalCodecError();
  }
}

export function decodeJournal(bytes: Uint8Array, trusted: JournalTrust): LaunchJournal {
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > JOURNAL_BYTE_LIMIT)
      throw new JournalCodecError();
    const owned = Buffer.from(bytes);
    if (owned[0] === 0xef && owned[1] === 0xbb && owned[2] === 0xbf) throw new JournalCodecError();
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(owned));
    const parsed = parseLaunchJournal(raw, trusted);
    if (!owned.equals(encodeJournal(parsed, trusted))) throw new JournalCodecError();
    return parsed;
  } catch {
    throw new JournalCodecError();
  }
}
