import { z } from "zod";
import { requireOwned, type ActiveActor } from "../identity/access";

export class ConnectionStoreError extends Error {
  constructor(readonly code: "invalid-input" | "not-found" | "conflict" | "unavailable" | "key-capacity" | "outcome-unknown") {
    super(code);
    this.name = "ConnectionStoreError";
  }
}
export function fail(code: ConnectionStoreError["code"]): never { throw new ConnectionStoreError(code); }
export const uuid = z.uuid().refine(value => value === value.toLowerCase());
export const ownerId = z.string().min(1).refine(value => value.isWellFormed() && !value.includes("\0") && Buffer.byteLength(value) <= 256);
export function requireConnectionActor(actor: ActiveActor): string {
  if (!actor || typeof actor.userId !== "string") return fail("not-found");
  requireOwned(actor, { ownerUserId: actor.userId });
  return ownerId.safeParse(actor.userId).success ? actor.userId : fail("not-found");
}
const provider = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const label = z.string().refine(value => value.isWellFormed() && !value.includes("\0") && [...value].length >= 1 && [...value].length <= 100 && Buffer.byteLength(value) <= 400);
const epoch = z.number().int().safe().refine(value => Number.isFinite(new Date(value).getTime()));
const revision = z.number().int().min(1).max(2147483647);
const expiry = epoch.nullable().optional().transform(value => value ?? null);
const secret = z.instanceof(Uint8Array).refine(value => value.byteLength >= 1 && value.byteLength <= 16384);
const create = z.strictObject({ operationId: uuid, provider, label, secret, expiresAt: expiry });
const replace = z.strictObject({ id: uuid, operationId: uuid, expectedRevision: revision, secret, expiresAt: expiry });
const revoke = z.strictObject({ id: uuid, operationId: uuid, expectedRevision: revision });
const list = z.strictObject({ cursor: z.string().min(1).max(2048).optional(), limit: z.number().int().min(1).max(100).default(50) });
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  return result.success ? result.data : fail("invalid-input");
}
function copySecret(value: Uint8Array): Buffer {
  let copy: Buffer | undefined;
  try {
    copy = Buffer.from(value);
    if (copy.byteLength < 1 || copy.byteLength > 16384) return fail("invalid-input");
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy);
    return copy;
  } catch {
    copy?.fill(0);
    return fail("invalid-input");
  }
}
export function parseCreate(input: unknown) {
  const fields = parse(create, input);
  return { ...fields, secret: copySecret(fields.secret) };
}
export function parseReplace(input: unknown) {
  const fields = parse(replace, input);
  return { ...fields, secret: copySecret(fields.secret) };
}
export const parseRevoke = (input: unknown) => parse(revoke, input);
export const parseList = (input: unknown) => parse(list, input);
export type CreateInput = ReturnType<typeof parseCreate>;
export type ReplaceInput = ReturnType<typeof parseReplace>;
export type RevokeInput = ReturnType<typeof parseRevoke>;
export type Mutation = Readonly<{ operation: "create-api-key"; input: CreateInput } | { operation: "replace-api-key"; input: ReplaceInput } | { operation: "revoke"; input: RevokeInput }>;

const date = z.date().transform(value => value.getTime()).pipe(epoch);
const metadataSchema = z.strictObject({
  id: uuid, kind: z.literal("api-key"), provider, label, state: z.enum(["active", "revoked"]), revision, credentialVersion: revision,
  createdAt: date, updatedAt: date, expiresAt: date.nullable(), revokedAt: date.nullable(),
}).refine(value => (value.state === "revoked") === (value.revokedAt !== null));
export type ConnectionMetadata = Readonly<z.infer<typeof metadataSchema>>;
export function metadata(row: unknown): ConnectionMetadata {
  const result = metadataSchema.safeParse(row);
  return result.success ? Object.freeze(result.data) : fail("unavailable");
}
export const optionsSchema = z.strictObject({
  configuration: z.strictObject({ key: z.string().length(44), keyId: z.string().regex(/^[a-z0-9_-]{1,32}$/) }),
  allowedProviders: z.array(provider).max(256), initializeEmpty: z.boolean(),
});
export function parseOptions(input: unknown) {
  const value = parse(optionsSchema, input);
  return { configuration: value.configuration, allowedProviders: new Set(value.allowedProviders), initializeEmpty: value.initializeEmpty };
}
