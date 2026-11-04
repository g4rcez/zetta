import { z } from "zod";
import { parseJournalOperation } from "./launch-journal";
import type { JournalEvent } from "./journal-transitions";
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const scope = {
  owner: z
    .strictObject({ receiptId: z.uuid(), attemptId: id, leaseId: id, fence: positive })
    .readonly(),
  atEpochMs: positive,
};
const operation = z.unknown().transform((raw) => parseJournalOperation(raw));
const schema = z.discriminatedUnion("type", [
  z.strictObject({ ...scope, type: z.literal("begin"), operation }).readonly(),
  z
    .strictObject({
      ...scope,
      type: z.literal("ack"),
      operationId: z.uuid(),
      operationSequence: positive,
      fact: z
        .strictObject({
          type: z.enum(["created_verified", "started", "input_written", "stopped", "removed"]),
          containerId: digest,
          containerName: z.string().min(1).max(64),
          ownershipLabel: digest,
          identityDigest: digest,
        })
        .readonly(),
    })
    .readonly(),
  z
    .strictObject({
      ...scope,
      type: z.literal("unknown"),
      operationId: z.uuid(),
      operationSequence: positive,
    })
    .readonly(),
  z.strictObject({ ...scope, type: z.literal("absent") }).readonly(),
  z
    .strictObject({
      ...scope,
      type: z.literal("cancel"),
      reason: z.enum(["owner", "deadline", "revocation", "shutdown", "recovery"]),
    })
    .readonly(),
]);
export class JournalEventError extends Error {
  readonly name = "JournalEventError";
  constructor() {
    super("journal_invalid");
  }
}
// Internal facts only: parsing a well-formed event does not authenticate its source.
export function parseJournalEvent(raw: unknown): JournalEvent {
  try {
    return schema.parse(raw);
  } catch {
    throw new JournalEventError();
  }
}
