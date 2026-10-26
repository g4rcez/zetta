import { expect, test } from "bun:test";
import { beginJournalLock, parseJournalLockPolicy } from "./journal-lock";

const policy = () => ({ root: "/var/lib/zetta/journal", uid: 1000, scope: { type: "admission" },
  flock: { sourceVersion: "2.41.3", sha256: "a".repeat(64), byteLength: 12345 }, bunVersion: "1.3.14", bunRevision: "0d9b296a" });

test("trusted policy is closed, copied, frozen and selects only fixed lock scopes", () => {
  const input = policy();
  const parsed = parseJournalLockPolicy(input);
  input.root = "/changed";
  input.flock.sha256 = "b".repeat(64);
  expect(parsed.root).toBe("/var/lib/zetta/journal");
  expect(parsed.flock.sha256).toBe("a".repeat(64));
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.flock)).toBe(true);
  expect(parseJournalLockPolicy({ ...policy(), scope: { type: "receipt", receiptId: "11111111-1111-4111-8111-111111111111" } }).scope.type).toBe("receipt");
});

for (const change of [
  { platform: "linux" }, { executable: "/tmp/flock" }, { argv: [] }, { timeoutMs: 1 }, { root: "relative" }, { root: "/var/../tmp" },
  { root: "/tmp/" }, { uid: -1 }, { uid: 1.5 }, { scope: { type: "receipt", receiptId: "../foreign" } },
  { scope: { type: "admission", path: "/tmp/foreign" } }, { flock: { sourceVersion: "2.41.3", sha256: "a".repeat(64), byteLength: 0 } },
  { flock: { sourceVersion: "unknown", sha256: "a".repeat(64), byteLength: 10 } }, { bunVersion: "" },
]) test("rejects malformed or authority-expanding lock policy", () => {
  expect(() => parseJournalLockPolicy({ ...policy(), ...change })).toThrow("invalid_lock_policy");
});

test("actual non-Linux host refuses before filesystem or helper activity", () => {
  // This is an unsupported-platform test, not a skipped Linux proof.
  expect(process.platform).toBe("darwin");
  let spawned = false;
  expect(() => beginJournalLock(policy(), () => { spawned = true; })).toThrow("capability_unavailable");
  expect(spawned).toBe(false);
});


test("admits reviewed2.39.3 without accepting unreviewed2.41 package identity", () => {
  const accepted = parseJournalLockPolicy({ ...policy(), flock: { sourceVersion: "2.39.3", sha256: "b991f23fbc6a3928a86977d87a6c4fd14acc44cfe90ce7cb8f5dcab4d8a49fbf", byteLength: 67816 } });
  expect(accepted.flock.sourceVersion).toBe("2.39.3");
  expect(accepted.flock.byteLength).toBe(67816);
  expect(() => parseJournalLockPolicy({ ...policy(), flock: { ...policy().flock, sourceVersion: "2.41" } })).toThrow("invalid_lock_policy");
});
