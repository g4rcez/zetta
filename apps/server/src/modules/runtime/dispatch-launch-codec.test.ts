import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalDispatchLaunchSpec, decodeDispatchLaunchSpec } from "./dispatch-launch-codec";
import { digestLaunchSpec, parseLaunchSpec } from "./launch-spec";
const tuple =
  '["zetta.launch.spec",1,["owner","run","attempt","bot","chat","config",null,null],"lease",1,"fixture-v1","echo","policy",31000,[30000,65536,65536,8192]]';

test("independent exact ten-position byte oracle agrees with existing008 digest", () => {
  const parsed = decodeDispatchLaunchSpec(tuple);
  expect(canonicalDispatchLaunchSpec(parsed)).toBe(tuple);
  expect(digestLaunchSpec(parsed)).toBe(createHash("sha256").update(tuple, "utf8").digest("hex"));
  for (const value of [parsed, parsed.context, parsed.budgets])
    expect(Object.isFrozen(value)).toBe(true);
  expect(() =>
    parseLaunchSpec(parsed, {
      nowEpochMs: 31000,
      authorizedDeadlineEpochMs: 31000,
      policyVersion: "policy",
    }),
  ).toThrow("deadline_denied");
  expect(decodeDispatchLaunchSpec(tuple)).toEqual(parsed);
});
test("every semantic position changes canonical bytes and digest without object-order dependence", () => {
  const base = decodeDispatchLaunchSpec(tuple),
    before = digestLaunchSpec(base);
  const changes = [
    ...[
      "actorId",
      "runId",
      "attemptId",
      "botId",
      "conversationId",
      "configurationId",
      "routineId",
      "delegationId",
    ].map((k) => ({ ...base, context: { ...base.context, [k]: "other" } })),
    { ...base, leaseId: "other" },
    { ...base, fence: 2 },
    { ...base, fixtureCase: "fork" },
    { ...base, policyVersion: "other" },
    { ...base, deadlineEpochMs: 31001 },
    ...["deadlineMs", "maxInputBytes", "maxOutputBytes", "maxFrameBytes"].map((k) => ({
      ...base,
      budgets: {
        ...base.budgets,
        [k]: k === "deadlineMs" ? 30001 : k === "maxFrameBytes" ? 8191 : 65535,
      },
    })),
  ];
  const hashes = changes.map((value) => {
    const text = canonicalDispatchLaunchSpec(value),
      parsed = decodeDispatchLaunchSpec(text);
    expect(text).not.toBe(tuple);
    expect(canonicalDispatchLaunchSpec(parsed)).toBe(text);
    return digestLaunchSpec(parsed);
  });
  expect(hashes.every((h) => h !== before)).toBe(true);
  expect(new Set(hashes).size).toBe(changes.length);
  expect(canonicalDispatchLaunchSpec(Object.fromEntries(Object.entries(base).reverse()))).toBe(
    tuple,
  );
});
test("rejects noncanonical bytes Unicode malformed shape and unknown version without logging input", () => {
  for (const bad of [
    null,
    {},
    "",
    "[",
    "{}",
    "[]",
    tuple + " ",
    " " + tuple,
    tuple.replace('"owner"', '"\\u006fwner"'),
    tuple.replace('"owner"', '"é"'),
    tuple.replace('"owner"', '"é"'),
    tuple.replace('"owner"', '"\\ud800"'),
    "\ud800",
    tuple + "\0",
    '["' + "é".repeat(8191) + '"]',
    tuple.replace(",1,", ",2,"),
    tuple.replace(",null,null]", ",null,null,null]"),
    tuple.slice(0, -1) + ",null]",
  ]) {
    expect(() => decodeDispatchLaunchSpec(bad)).toThrow("invalid_spec");
  }
  const base = decodeDispatchLaunchSpec(tuple);
  for (const bad of [
    { ...base, extra: true },
    { ...base, version: 2 },
    { ...base, recipe: "native" },
    { ...base, context: { ...base.context, extra: true } },
  ])
    expect(() => canonicalDispatchLaunchSpec(bad)).toThrow("invalid_spec");
});
test("ASCII identifier and numeric budget boundaries preserve008 limits", () => {
  const base = decodeDispatchLaunchSpec(tuple),
    max = {
      ...base,
      leaseId: "a".repeat(128),
      policyVersion: "p".repeat(128),
      fence: Number.MAX_SAFE_INTEGER,
      budgets: { ...base.budgets, deadlineMs: 60000 },
    };
  expect(decodeDispatchLaunchSpec(canonicalDispatchLaunchSpec(max)).leaseId.length).toBe(128);
  for (const bad of [
    { ...max, leaseId: "a".repeat(129) },
    { ...max, fence: Number.MAX_SAFE_INTEGER + 1 },
    { ...max, fence: NaN },
    { ...max, deadlineEpochMs: Infinity },
    { ...max, budgets: { ...max.budgets, deadlineMs: 60001 } },
    { ...max, budgets: { ...max.budgets, maxInputBytes: 65537 } },
    { ...max, budgets: { ...max.budgets, maxFrameBytes: 8193 } },
  ])
    expect(() => canonicalDispatchLaunchSpec(bad)).toThrow("invalid_spec");
});
