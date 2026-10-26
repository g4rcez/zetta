import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { BotContractError } from "./bot-contract";
import { canonicalBotDefinition, decodeBotDefinition, fingerprintBotDefinition, canonicalBotBinding, decodeBotBinding,
  fingerprintBotBinding, canonicalBotMutation, decodeBotMutation } from "./bot-canonical";

const botId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const connectionId = "00000000-0000-4000-8000-000000000003";
const definition = { version: 1, visibility: "team", harness: "pi", model: { provider: "vendor", id: "model" }, personality: "p", instructions: "i",
  catalogReferences: [], requiredCapabilities: ["resume"], integrations: [{ key: "mail", provider: "vendor", kind: "api-key", required: true }] };
const binding = { version: 1, actorId: "actor-a", botId, bindingVersion: 1,
  connections: [{ key: "mail", connectionId, credentialVersion: 1 }], nativeProfile: null, privateResources: [] };

test("encodes complete definition when caller property order differs", () => {
  // Given an independent full canonical byte oracle.
  const expected = '["zetta.bot.definition",1,{"version":1,"visibility":"team","harness":"pi","model":{"provider":"vendor","id":"model"},"personality":"p","instructions":"i","catalogReferences":[],"requiredCapabilities":["resume"],"integrations":[{"key":"mail","provider":"vendor","kind":"api-key","required":true}]}]';
  // When canonicalizing a reordered request.
  const { integrations, ...rest } = definition;
  const result = canonicalBotDefinition({ integrations, ...rest });
  // Then exact bytes and the independent digest bind the whole tuple.
  expect(result).toBe(expected);
  expect(fingerprintBotDefinition(definition)).toBe(createHash("sha256").update(expected).digest("hex"));
});
test.each([
  { visibility: "private" }, { harness: "codex" }, { model: null }, { model: { provider: "other", id: "model" } },
  { model: { provider: "vendor", id: "other" } }, { personality: "other" }, { instructions: "other" },
  { requiredCapabilities: ["modelSelection"] }, { integrations: [] },
  { integrations: [{ key: "other", provider: "vendor", kind: "api-key", required: true }] },
  { integrations: [{ key: "mail", provider: "other", kind: "api-key", required: true }] },
  { integrations: [{ key: "mail", provider: "vendor", kind: "api-key", required: false }] },
])("changes definition fingerprint when a semantic field changes %j", patch => {
  // Given a legal semantic substitution.
  const altered = { ...definition, ...patch };
  // When fingerprinting both definitions.
  const changed = fingerprintBotDefinition(altered) !== fingerprintBotDefinition(definition);
  // Then identity differs for every substitution.
  expect(changed).toBe(true);
});
test.each([
  (s: string) => ` ${s}`, (s: string) => s.replace('"version":1', '"version":1.0'),
  (s: string) => s.replace('"personality":"p"', '"personality":"\\u0070"'),
  (s: string) => s.replace('"harness":"pi"', '"harness":"codex","harness":"pi"'),
  (s: string) => s.replace('"catalogReferences":[]', '"catalogReferences":[],"secret":"x"'),
  (s: string) => s.replace('"zetta.bot.definition"', '"zetta.bot.binding"'),
])("denies noncanonical or substituted stored bytes", change => {
  // Given altered wire bytes for an otherwise known definition.
  const raw = change(canonicalBotDefinition(definition));
  // When decoding.
  const act = () => decodeBotDefinition(raw);
  // Then canonical storage cannot normalize away the alteration.
  expect(act).toThrow(BotContractError);
});
test("round-trips definition when canonical bytes are unchanged", () => {
  // Given known canonical bytes.
  const raw = canonicalBotDefinition(definition);
  // When decoding.
  const decoded = decodeBotDefinition(raw);
  // Then the complete definition is restored without authority metadata.
  expect<unknown>(decoded).toEqual(definition);
});
test.each([
  { actorId: "actor-b" }, { botId: operationId }, { bindingVersion: 2 },
  { connections: [{ key: "other", connectionId, credentialVersion: 1 }] },
  { connections: [{ key: "mail", connectionId: operationId, credentialVersion: 1 }] },
  { connections: [{ key: "mail", connectionId, credentialVersion: 2 }] }, { connections: [] },
])("binds private identity when a binding field changes %j", patch => {
  // Given a structurally valid different actor or pinned selection.
  const altered = { ...binding, ...patch };
  // When fingerprinting.
  const changed = fingerprintBotBinding(binding) !== fingerprintBotBinding(altered);
  // Then private snapshots cannot alias.
  expect(changed).toBe(true);
});
test("round-trips binding with an independent complete byte oracle", () => {
  // Given explicit expected stored bytes.
  const raw = `["zetta.bot.binding",1,{"version":1,"actorId":"actor-a","botId":"${botId}","bindingVersion":1,"connections":[{"key":"mail","connectionId":"${connectionId}","credentialVersion":1}],"nativeProfile":null,"privateResources":[]}]`;
  // When encoding and decoding the snapshot.
  const encoded = canonicalBotBinding(binding), decoded = decodeBotBinding(raw);
  // Then no private identity field is omitted.
  expect(encoded).toBe(raw);
  expect<unknown>(decoded).toEqual(binding);
});
test.each([
  { kind: "create_specialist", name: "Bot", description: "", definition },
  { kind: "ensure_chief", name: "Chief", description: "", definition: { ...definition, visibility: "private" } },
  { kind: "edit_presentation", botId, expectedPresentationRevision: 1, name: "Bot", description: "" },
  { kind: "append_definition", botId, expectedConfigurationVersion: 1, expectedRevision: 1, definition },
  { kind: "change_visibility", botId, expectedConfigurationVersion: 1, expectedRevision: 1, definition },
  { kind: "archive", botId, expectedConfigurationVersion: 1, expectedRevision: 1 },
  { kind: "restore", botId, expectedConfigurationVersion: 1, expectedRevision: 1 },
  { kind: "update_bindings", botId, expectedConfigurationVersion: 1, expectedBindingVersion: null, connections: binding.connections, nativeProfile: null, privateResources: [] },
])("round-trips exact mutation arguments for $kind", fields => {
  // Given a supported method with mandatory CAS identity.
  const input = { version: 1, operationId, ...fields };
  // When round-tripping canonical arguments.
  const decoded = decodeBotMutation(canonicalBotMutation(input));
  // Then original operation and method-specific semantic arguments survive.
  expect<unknown>(decoded).toEqual(input);
});
test.each([
  { operationId: connectionId }, { botId: connectionId }, { expectedRevision: 2 }, { expectedConfigurationVersion: 2 }, { kind: "restore" },
])("changes replay bytes when lifecycle argument changes %j", patch => {
  // Given a lifecycle mutation and one changed argument.
  const original = { version: 1, operationId, kind: "archive", botId, expectedConfigurationVersion: 1, expectedRevision: 1 };
  // When comparing canonical replay arguments.
  const same = canonicalBotMutation(original) === canonicalBotMutation({ ...original, ...patch });
  // Then an operation receipt cannot confuse the requests.
  expect(same).toBe(false);
});
test.each([
  { name: "Other" }, { description: "other" }, { expectedPresentationRevision: 2 },
])("binds presentation replay arguments when one field changes %j", patch => {
  // Given a cosmetic mutation independent of configuration versioning.
  const original = { version: 1, operationId, kind: "edit_presentation", botId, expectedPresentationRevision: 1, name: "Bot", description: "" };
  // When comparing canonical arguments.
  const same = canonicalBotMutation(original) === canonicalBotMutation({ ...original, ...patch });
  // Then every presentation argument participates in idempotency.
  expect(same).toBe(false);
});
test.each([
  { expectedBindingVersion: 1 }, { expectedConfigurationVersion: 2 }, { connections: [] },
])("binds binding mutation arguments when one field changes %j", patch => {
  // Given an insert-or-update CAS with null meaning no prior binding.
  const original = { version: 1, operationId, kind: "update_bindings", botId, expectedConfigurationVersion: 1,
    expectedBindingVersion: null, connections: binding.connections, nativeProfile: null, privateResources: [] };
  // When comparing replay identities.
  const same = canonicalBotMutation(original) === canonicalBotMutation({ ...original, ...patch });
  // Then absent-versus-existing and the selected snapshot cannot alias.
  expect(same).toBe(false);
});
test("binds nested definition in mutation replay identity", () => {
  // Given an edit and a changed instruction in its full definition.
  const original = { version: 1, operationId, kind: "append_definition", botId, expectedConfigurationVersion: 1, expectedRevision: 1, definition };
  // When comparing exact argument bytes.
  const same = canonicalBotMutation(original) === canonicalBotMutation({ ...original, definition: { ...definition, instructions: "changed" } });
  // Then identical operation identity cannot hide a changed execution definition.
  expect(same).toBe(false);
});
test.each([null, "", "[]", "{}", "not json", "x".repeat(40961), '["zetta.bot.definition",2,{}]'])("rejects malformed canonical input %j", raw => {
  // Given malformed or over-limit stored bytes.
  const input = raw;
  // When invoking all exact decoders.
  const acts = [() => decodeBotDefinition(input), () => decodeBotBinding(input), () => decodeBotMutation(input)];
  // Then no decoder accepts a partial or permissive representation.
  for (const act of acts) expect(act).toThrow(BotContractError);
});
