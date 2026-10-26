import { expect, test } from "bun:test";
import { BotContractError, parseBotDefinition, parseBotBinding, parseBotMutation, projectBotSummary } from "./bot-contract";

const botId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const connectionId = "00000000-0000-4000-8000-000000000003";
const definition = { version: 1, visibility: "team", harness: "pi", model: null, personality: "", instructions: "",
  catalogReferences: [], requiredCapabilities: [], integrations: [] };
const selections = [{ key: "mail", connectionId, credentialVersion: 1 }];
const binding = { version: 1, actorId: "actor-a", botId, bindingVersion: 1, connections: selections, nativeProfile: null, privateResources: [] };

test.each(["pi", "codex", "omp", "claude-code", "opencode", "cursor"])("accepts inert native definition when harness is %s", harness => {
  // Given a supported configuration name, not runtime evidence.
  const input = { ...definition, harness };
  // When the definition crosses the structural boundary.
  const parsed = parseBotDefinition(input);
  // Then only the requested inert configuration is returned.
  expect(parsed.harness).toBe(harness);
  expect("ready" in parsed).toBe(false);
});
test.each([
  { harness: "fixture" }, { version: 2 }, { secret: "synthetic" }, { ready: true }, { instructions: "\ud800" },
  { personality: "\0" }, { model: { provider: "INVALID", id: "model" } }, { model: { provider: "vendor", id: "../../path" } },
  { catalogReferences: [{ id: "opaque", version: 1 }] }, { requiredCapabilities: ["unknown"] },
  { requiredCapabilities: ["resume", "resume"] }, { integrations: [{ key: "x", provider: "vendor", kind: "native", required: true }] },
  { integrations: [{ key: "x", provider: "vendor", kind: "api-key", required: true, credential: "synthetic" }] },
])("rejects unsupported or private definition fields when input is %j", patch => {
  // Given a malformed or authority-bearing patch.
  const input = { ...definition, ...patch };
  // When parsing the definition.
  const act = () => parseBotDefinition(input);
  // Then a fixed boundary error carries no input.
  expect(act).toThrow(new BotContractError("invalid_definition"));
});
test.each([
  ["personality", "😀".repeat(1024), true], ["personality", "😀".repeat(1025), false],
  ["instructions", "é".repeat(8192), true], ["instructions", "é".repeat(8193), false],
  ["instructions", "\u0001".repeat(6000), false],
] as const)("enforces UTF8 and canonical caps when %s boundary is exercised", (field, value, accepted) => {
  // Given characters whose code-unit, UTF8 and JSON-escaped sizes differ.
  const input = { ...definition, [field]: value };
  // When parsing at the relevant byte boundary.
  const act = () => parseBotDefinition(input);
  // Then field and total canonical byte limits both apply.
  if (accepted) expect(act()[field]).toBe(value); else expect(act).toThrow(BotContractError);
});
test("normalizes unique requirements when caller order differs", () => {
  // Given reversed nonduplicate capabilities and integration keys.
  const integrations = ["z", "a"].map(key => ({ key, provider: "vendor", kind: "api-key", required: true }));
  // When parsing.
  const parsed = parseBotDefinition({ ...definition, integrations, requiredCapabilities: ["resume", "hostTools"] });
  // Then canonical order and deep immutability do not depend on caller order.
  expect(parsed.integrations.map(x => x.key)).toEqual(["a", "z"]);
  expect(parsed.requiredCapabilities).toEqual(["hostTools", "resume"]);
  expect(Object.isFrozen(parsed.integrations[0])).toBe(true);
  expect(Object.isFrozen(parsed.requiredCapabilities)).toBe(true);
});
test("denies oversized collections before visiting elements", () => {
  // Given an oversized array with a visitation sentinel.
  let visits = 0;
  const integrations = Array.from({ length: 17 }, () => ({ get key() { visits++; return "x"; } }));
  // When parsing the over-limit collection.
  const act = () => parseBotDefinition({ ...definition, integrations });
  // Then no element traversal occurs.
  expect(act).toThrow(BotContractError);
  expect(visits).toBe(0);
});
test("rejects duplicate keys when requirements disagree", () => {
  // Given two requirements with the same identity.
  const integrations = [true, false].map(required => ({ key: "mail", provider: "vendor", kind: "api-key", required }));
  // When parsing.
  const act = () => parseBotDefinition({ ...definition, integrations });
  // Then normalization cannot choose a winner.
  expect(act).toThrow(BotContractError);
});
test("copies private binding when caller later mutates selections", () => {
  // Given a mutable input owned by the caller.
  const original = { key: "mail", connectionId, credentialVersion: 1 };
  const input = { ...binding, connections: [original] };
  // When parsing then changing the original input.
  const parsed = parseBotBinding(input); original.credentialVersion = 2;
  // Then pinned versions remain immutable and no readiness/ownership authority appears.
  expect(parsed.connections[0]?.credentialVersion).toBe(1);
  expect(Object.isFrozen(parsed.connections[0])).toBe(true);
  expect("ready" in parsed).toBe(false);
});
test.each([
  { nativeProfile: "path" }, { privateResources: ["memory"] }, { actorId: "foreign/actor" }, { bindingVersion: 0 },
  { connections: [{ key: "mail", connectionId, credentialVersion: 0 }] }, { connections: [...selections, ...selections] },
  { connections: [{ ...selections[0], accountName: "synthetic" }] }, { ready: true },
])("denies malformed private binding when input is %j", patch => {
  // Given unsupported or inconsistent binding data.
  const input = { ...binding, ...patch };
  // When parsing structure only.
  const act = () => parseBotBinding(input);
  // Then unsupported data cannot enter the binding.
  expect(act).toThrow(new BotContractError("invalid_binding"));
});
test.each(["", " ", "😀".repeat(81), "\ud800", "a\0"])("denies invalid presentation name when %j", name => {
  // Given a presentation edit with invalid scalar text.
  const input = { version: 1, operationId, kind: "edit_presentation", botId, expectedPresentationRevision: 1, name, description: "" };
  // When parsing the mutation.
  const act = () => parseBotMutation(input);
  // Then invalid names cannot be stored.
  expect(act).toThrow(BotContractError);
});
test("accepts scalar-name boundary when supplementary Unicode fills the byte cap", () => {
  // Given eighty four-byte scalars.
  const name = "😀".repeat(80);
  // When parsing a presentation mutation.
  const result = parseBotMutation({ version: 1, operationId, kind: "edit_presentation", botId, expectedPresentationRevision: 1, name, description: "" });
  // Then scalar length, not UTF16 length, determines acceptance.
  expect(result.kind).toBe("edit_presentation");
});
test.each([0, -1, 1.5, 2147483648, Number.NaN, Number.POSITIVE_INFINITY])("denies unsafe CAS token when %s", expectedRevision => {
  // Given an invalid expected lifecycle revision.
  const input = { version: 1, operationId, kind: "archive", botId, expectedConfigurationVersion: 1, expectedRevision };
  // When parsing.
  const act = () => parseBotMutation(input);
  // Then an invalid CAS input never reaches storage.
  expect(act).toThrow(BotContractError);
});
test("rejects actor and approval flags when mutation would otherwise be valid", () => {
  // Given a structurally valid archive with invented authority.
  const input = { version: 1, operationId, kind: "archive", botId, expectedConfigurationVersion: 1, expectedRevision: 1, actorId: "actor-a", approved: true };
  // When parsing.
  const act = () => parseBotMutation(input);
  // Then authority cannot be supplied in mutation arguments.
  expect(act).toThrow(BotContractError);
});
test("denies team chief when ensure-chief contains a public definition", () => {
  // Given a create request that violates chief privacy.
  const input = { version: 1, operationId, kind: "ensure_chief", name: "Chief", description: "", definition };
  // When parsing.
  const act = () => parseBotMutation(input);
  // Then chief identity cannot publish a team definition.
  expect(act).toThrow(BotContractError);
});
test("projects safe summary when internal row includes private columns", () => {
  // Given an internal authorized row with private extras.
  const input = { id: botId, kind: "specialist", visibility: "team", lifecycle: "active", configurationVersion: 1,
    revision: 1, presentationRevision: 1, name: "Bot", description: "", canEdit: false,
    ownerUserId: "actor-a", bindingId: "private", readinessDigest: "private", accountName: "private", definition };
  // When projecting a transport DTO after caller authorization.
  const result = projectBotSummary(input);
  // Then only the declared safe fields survive.
  expect(Object.keys(result).sort()).toEqual(["canEdit", "configurationVersion", "description", "id", "kind", "lifecycle", "name", "presentationRevision", "revision", "visibility"]);
  expect(Object.isFrozen(result)).toBe(true);
});
test.each(["binding", "capabilities", "catalog"])("rejects oversized %s collection without reading elements", slot => {
  // Given over-limit data whose first element records traversal.
  let visits = 0;
  const values = new Array(slot === "binding" ? 17 : slot === "capabilities" ? 5 : 1);
  Object.defineProperty(values, "0", { get() { visits++; return {}; } });
  // When parsing the selected collection.
  const act = () => slot === "binding" ? parseBotBinding({ ...binding, connections: values })
    : parseBotDefinition({ ...definition, [slot === "capabilities" ? "requiredCapabilities" : "catalogReferences"]: values });
  // Then every collection cap rejects before element traversal.
  expect(act).toThrow(BotContractError);
  expect(visits).toBe(0);
});
test.each(["\udfff", "\0", "é".repeat(1025)])("rejects invalid description when presentation is otherwise valid", description => {
  // Given invalid scalar/byte content in a cosmetic field.
  const input = { version: 1, operationId, kind: "edit_presentation", botId, expectedPresentationRevision: 1, name: "Bot", description };
  // When parsing the mutation.
  const act = () => parseBotMutation(input);
  // Then cosmetic fields retain the same text guarantees.
  expect(act).toThrow(BotContractError);
});
test("accepts incomplete binding as structure when ownership and requirement resolution are absent", () => {
  // Given an actor-specific empty binding without resource evidence.
  const input = { ...binding, connections: [] };
  // When parsing a private snapshot.
  const result = parseBotBinding(input);
  // Then no completeness, capability or readiness result is invented.
  expect(result.connections).toEqual([]);
  expect(Object.keys(result).sort()).toEqual(["actorId", "bindingVersion", "botId", "connections", "nativeProfile", "privateResources", "version"]);
});
test.each(["gpt-5.4", "vendor/model-v2.1", "model:version-2", "vendor/model:2.1"])("accepts opaque model selector when %s", id => {
  // Given a dotted, namespaced or versioned selector, not a resource ID.
  const input = { ...definition, model: { provider: "openai", id } };
  // When parsing inert model configuration.
  const result = parseBotDefinition(input);
  // Then the exact selector survives without proving model availability.
  expect(result.model?.id).toBe(id);
});
test.each(["https://host/model", "file:///tmp/model", "vendor/../model", "vendor/./model", "vendor/model/..", "vendor/model/.",
  "-option", "/absolute", "a\\b", "a\nb", "a\0b", "a b", "é", "a".repeat(129), ""])("denies unsafe model selector when %j", id => {
  // Given URL, traversal, option-like or out-of-bound selector syntax.
  const input = { ...definition, model: { provider: "vendor", id } };
  // When parsing the model-only selector boundary.
  const act = () => parseBotDefinition(input);
  // Then it cannot become a URL or filesystem selector through this contract.
  expect(act).toThrow(BotContractError);
});
