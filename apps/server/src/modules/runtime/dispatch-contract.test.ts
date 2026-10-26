import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalDispatchAction, createInputDispatchAction, decodeDispatchAction, digestDispatchAction, parseDispatchAction } from "./dispatch-contract";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const activate = () => ({ version: 1, ownerUserId: "actor", runId: uuid(1), attemptId: uuid(2), generation: 1,
  leaseId: uuid(3), actionId: uuid(4), launcherInstallationId: "launcher", policyVersion: "fixture-v1", receiptId: uuid(5),
  kind: "activate", sequence: 1, connectionId: null, credentialVersion: null, expiresAtMs: 20_000,
  descriptor: ["activate", uuid(4), "a".repeat(64)] });
const input = () => ({ ...activate(), kind: "input", sequence: 2, descriptor: ["input", uuid(4), 2, 3, false, "b".repeat(64)] });

describe("dispatch canonical boundary", () => {
  test("matches the independent fixed tuple and digest", () => {
    // Given: the ADR tuple is written independently of the encoder.
    const expected = JSON.stringify(["zetta.dispatch.action", 1, "actor", uuid(1), uuid(2), 1, uuid(3), uuid(4), "launcher", "fixture-v1", uuid(5), "activate", 1, null, null, 20_000, ["activate", uuid(4), "a".repeat(64)]]);
    // When: encoding the structured fixture action.
    const actual = canonicalDispatchAction(activate());
    // Then: bytes, parsed identity and digest agree with the independent oracle.
    expect(actual).toBe(expected);
    expect(digestDispatchAction(activate())).toBe(createHash("sha256").update(expected, "utf8").digest("hex"));
    expect(canonicalDispatchAction(decodeDispatchAction(expected))).toBe(expected);
  });
  const changes = [
    { ownerUserId: "other" }, { runId: uuid(10) }, { attemptId: uuid(11) }, { generation: 2 }, { leaseId: uuid(12) },
    { actionId: uuid(13), descriptor: ["activate", uuid(13), "a".repeat(64)] }, { launcherInstallationId: "other" },
    { policyVersion: "other" }, { receiptId: uuid(14) }, { expiresAtMs: 20_001 }, { descriptor: ["activate", uuid(4), "c".repeat(64)] },
  ];
  test.each(changes)("binds every mutable activation tuple field %j", change => {
    // Given: an independently changed legal identity.
    const original = canonicalDispatchAction(activate());
    // When: encoding the substitution.
    const changed = canonicalDispatchAction({ ...activate(), ...change });
    // Then: it cannot retain equality or digest.
    expect(changed).not.toBe(original);
    expect(digestDispatchAction({ ...activate(), ...change })).not.toBe(digestDispatchAction(activate()));
  });
  test.each([
    { sequence: 3, descriptor: ["input", uuid(4), 3, 3, false, "b".repeat(64)] },
    { descriptor: ["input", uuid(4), 2, 4, false, "b".repeat(64)] },
    { descriptor: ["input", uuid(4), 2, 3, true, "b".repeat(64)] },
    { descriptor: ["input", uuid(4), 2, 3, false, "c".repeat(64)] },
  ])("binds each input descriptor field %j", change => {
    // Given: one valid input descriptor.
    const original = canonicalDispatchAction(input());
    // When: changing a descriptor field.
    const changed = canonicalDispatchAction({ ...input(), ...change });
    // Then: canonical identity differs.
    expect(changed).not.toBe(original);
  });
  test.each([
    { version: 2 }, { ownerUserId: "é" }, { ownerUserId: "x".repeat(129) }, { runId: "run" }, { runId: "ABCDEFAB-0000-4000-8000-000000000001" },
    { generation: 2147483648 }, { sequence: 2 }, { actionId: uuid(99) }, { connectionId: uuid(8) }, { credentialVersion: 1 },
    { kind: "tool" }, { descriptor: ["activate", uuid(4), "A".repeat(64)] }, { descriptor: ["activate", uuid(4), "a".repeat(64), "extra"] },
    { expiresAtMs: Infinity }, { expiresAtMs: 1.5 }, { extra: true },
  ])("rejects unsupported or malformed activation %j", change => {
    // Given: a changed boundary value.
    const raw = { ...activate(), ...change };
    // When/Then: parsing refuses it before a draft exists.
    expect(() => parseDispatchAction(raw)).toThrow();
  });
  test.each([
    ["input", uuid(4), 2, 0, false, "b".repeat(64)], ["input", uuid(4), 2, 8193, false, "b".repeat(64)],
    ["input", uuid(4), 3, 3, false, "b".repeat(64)], ["input", uuid(7), 2, 3, false, "b".repeat(64)],
  ])("rejects inconsistent input %j", (...descriptor) => {
    // Given: invalid input metadata.
    const raw = { ...input(), descriptor };
    // When/Then: no valid action is produced.
    expect(() => parseDispatchAction(raw)).toThrow();
  });
  test("hashes copied exact bytes and retains no payload", () => {
    // Given: multibyte UTF-8 and a trusted action binding.
    const bytes = new TextEncoder().encode("é🙂");
    const binding = activate();
    const { descriptor: _, kind: __, sequence: ___, ...identity } = binding;
    // When: constructing then changing the original buffer.
    const action = createInputDispatchAction(identity, { bytes, sequence: 1, eof: false });
    bytes.fill(0);
    // Then: the independent hash/count persist and bytes are absent.
    expect(action.descriptor).toEqual(["input", uuid(4), 1, 6, false, createHash("sha256").update("é🙂", "utf8").digest("hex")]);
    expect(Object.isFrozen(action)).toBe(true);
    expect(Object.isFrozen(action.descriptor)).toBe(true);
    expect(canonicalDispatchAction(action)).not.toContain("é");
  });
  test("canonical read rejects alternate encodings and oversized text", () => {
    // Given: canonical text and malformed alternative forms.
    const canonical = canonicalDispatchAction(activate());
    const invalid = [` ${canonical}`, canonical.replace('"actor"', '"\\u0061ctor"'), canonical.replace(",20000,", ",2e4,"), "x".repeat(16385), "[", `${canonical}\n`];
    // When/Then: each alternative fails exact canonical decoding.
    for (const value of invalid) expect(() => decodeDispatchAction(value)).toThrow();
  });
  test("matches the independent input tuple with a separate sequence space", () => {
    // Given: input sequence1 is distinct from activation sequence1.
    const raw = { ...input(), sequence: 1, descriptor: ["input", uuid(4), 1, 0, true, "b".repeat(64)] };
    const expected = JSON.stringify(["zetta.dispatch.action", 1, "actor", uuid(1), uuid(2), 1, uuid(3), uuid(4), "launcher", "fixture-v1", uuid(5), "input", 1, null, null, 20_000, ["input", uuid(4), 1, 0, true, "b".repeat(64)]]);
    // When: encoding the input action.
    const canonical = canonicalDispatchAction(raw);
    // Then: both kind and descriptor bind the input sequence space.
    expect(canonical).toBe(expected);
    expect(canonical).not.toBe(canonicalDispatchAction(activate()));
  });
  test("rejects impossible minimum aggregate input bytes", () => {
    // Given: every preceding non-EOF input consumed at least one byte.
    const raw = { ...input(), sequence: 65537, descriptor: ["input", uuid(4), 65537, 1, false, "b".repeat(64)] };
    // When/Then: even minimum aggregate bytes exceed the fixture budget.
    expect(() => parseDispatchAction(raw)).toThrow();
    expect(parseDispatchAction({ ...raw, descriptor: ["input", uuid(4), 65537, 0, true, "b".repeat(64)] }).sequence).toBe(65537);
  });
  test("parsing copies a caller descriptor before freezing", () => {
    // Given: a mutable input object.
    const raw = activate();
    // When: parsing then changing its array.
    const parsed = parseDispatchAction(raw);
    raw.descriptor[2] = "c".repeat(64);
    // Then: the accepted identity is unchanged.
    expect(parsed.descriptor[2]).toBe("a".repeat(64));
  });
});
