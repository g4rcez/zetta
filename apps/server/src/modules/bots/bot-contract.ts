import { z } from "zod";
import type { HarnessCapabilities } from "../runtime/harness";
import { runCounterSchema, runIdSchema, runUuidSchema } from "../runtime/run-contract";

export class BotContractError extends Error {
  readonly name = "BotContractError";
  constructor(readonly code: "invalid_definition" | "invalid_binding" | "invalid_mutation" | "invalid_summary") { super(code); }
}
const botId = runUuidSchema.brand<"BotId">();
const actorId = runIdSchema.brand<"ActorId">();
const operationId = runUuidSchema.brand<"BotOperationId">();
const connectionId = runUuidSchema.brand<"ConnectionId">();
const visibility = z.enum(["private", "team"]);
const nativeHarness = z.enum(["pi", "codex", "omp", "claude-code", "opencode", "cursor"] as const satisfies readonly Exclude<HarnessCapabilities["harness"], "fixture">[]);
const capability = z.enum(["resume", "modelSelection", "modelCatalog", "hostTools"] as const satisfies readonly Exclude<keyof HarnessCapabilities, "version" | "harness">[]);
const provider = z.string().regex(/^[a-z0-9-]{1,64}$/);
function text(bytes: number) {
  return z.string().max(bytes).refine(value => value.isWellFormed() && !value.includes("\0") && Buffer.byteLength(value, "utf8") <= bytes);
}
const name = text(320).refine(value => value.trim().length > 0 && [...value].length <= 80);
const presentation = { name, description: text(2048) };
const modelSelector = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/)
  .refine(value => !value.includes("://") && !value.split("/").some(segment => segment === "." || segment === ".."));
const model = z.strictObject({ provider, id: modelSelector }).readonly().nullable();
const integration = z.strictObject({ key: runIdSchema, provider, kind: z.literal("api-key"), required: z.boolean() }).readonly();
const integrations = z.array(integration).max(16).refine(values => new Set(values.map(value => value.key)).size === values.length)
  .transform(values => values.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).readonly();
const capabilities = z.array(capability).max(4).refine(values => new Set(values).size === values.length).transform(values => values.sort()).readonly();
const emptyReferences = z.tuple([]).readonly();
const definitionSchema = z.strictObject({
  version: z.literal(1), visibility, harness: nativeHarness, model, personality: text(4096), instructions: text(16384),
  catalogReferences: emptyReferences, requiredCapabilities: capabilities, integrations,
}).refine(value => Buffer.byteLength(JSON.stringify(["zetta.bot.definition", 1, value]), "utf8") <= 32768).readonly();
export type BotDefinition = z.infer<typeof definitionSchema>;
export function parseBotDefinition(raw: unknown): BotDefinition {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) throw new BotContractError("invalid_definition");
  return parsed.data;
}
const selection = z.strictObject({ key: runIdSchema, connectionId, credentialVersion: runCounterSchema }).readonly();
const connections = z.array(selection).max(16).refine(values => new Set(values.map(value => value.key)).size === values.length)
  .transform(values => values.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).readonly();
const bindingFields = { connections, nativeProfile: z.null(), privateResources: emptyReferences };
const bindingSchema = z.strictObject({ version: z.literal(1), actorId, botId, bindingVersion: runCounterSchema, ...bindingFields })
  .refine(value => Buffer.byteLength(JSON.stringify(["zetta.bot.binding", 1, value]), "utf8") <= 16384).readonly();
export type BotBinding = z.infer<typeof bindingSchema>;
/** Parses private snapshot structure only; no ownership, resource existence or readiness is established. */
export function parseBotBinding(raw: unknown): BotBinding {
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) throw new BotContractError("invalid_binding");
  return parsed.data;
}
const mutationIdentity = { version: z.literal(1), operationId };
const configurationCas = { botId, expectedConfigurationVersion: runCounterSchema, expectedRevision: runCounterSchema };
const mutationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...mutationIdentity, kind: z.literal("create_specialist"), ...presentation, definition: definitionSchema }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("ensure_chief"), ...presentation, definition: definitionSchema.refine(value => value.visibility === "private") }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("edit_presentation"), botId, expectedPresentationRevision: runCounterSchema, ...presentation }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("append_definition"), ...configurationCas, definition: definitionSchema }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("change_visibility"), ...configurationCas, definition: definitionSchema }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("archive"), ...configurationCas }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("restore"), ...configurationCas }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("update_bindings"), botId, expectedConfigurationVersion: runCounterSchema,
    expectedBindingVersion: runCounterSchema.nullable(), ...bindingFields }),
]).refine(value => Buffer.byteLength(JSON.stringify(["zetta.bot.mutation", 1, value]), "utf8") <= 40960).readonly();
export type BotMutation = z.infer<typeof mutationSchema>;
export function parseBotMutation(raw: unknown): BotMutation {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) throw new BotContractError("invalid_mutation");
  return parsed.data;
}
const summarySchema = z.object({
  id: botId, kind: z.enum(["chief", "specialist"]), visibility, lifecycle: z.enum(["active", "archived"]),
  configurationVersion: runCounterSchema, revision: runCounterSchema, presentationRevision: runCounterSchema,
  ...presentation, canEdit: z.boolean(),
}).refine(value => value.kind !== "chief" || value.visibility === "private").readonly();
export type BotSummary = z.infer<typeof summarySchema>;
/** Only projects allowed fields. The caller must authorize the read and derive canEdit before calling. */
export function projectBotSummary(raw: unknown): BotSummary {
  const parsed = summarySchema.safeParse(raw);
  if (!parsed.success) throw new BotContractError("invalid_summary");
  return parsed.data;
}
