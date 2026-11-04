import { expect, test as bunTest } from "bun:test";
// The journal store needs POSIX uids, modes and paths, so it is not run on Windows.
const test = process.platform === "win32" ? bunTest.skip : bunTest;
import { openJournalStore } from "./journal-store";
test("store has no platform override or caller attestation", async () => {
  await expect(openJournalStore({ ext4Verified: true })).rejects.toThrow("journal_invalid");
});

import { assertJournalReplay, createJournalStoreLifetime } from "./journal-store";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import { createLaunchJournal } from "./launch-journal";
import { parseStoredLaunchSpec, parseLaunchSpec } from "./launch-spec";
const policy = createFixtureLaunchPolicy({
  installationId: "fixture",
  policyVersion: "fixture",
  image: `sha256:${"1".repeat(64)}`,
});
const admission = { nowEpochMs: 1000, authorizedDeadlineEpochMs: 61000, policyVersion: "fixture" };
const spec = parseStoredLaunchSpec({
  version: 1,
  context: {
    actorId: "a",
    runId: "r",
    attemptId: "t",
    botId: "b",
    conversationId: "c",
    configurationId: "f",
  },
  leaseId: "l",
  fence: 1,
  recipe: "fixture-v1",
  fixtureCase: "echo",
  policyVersion: "fixture",
  deadlineEpochMs: 61000,
  budgets: { deadlineMs: 60000, maxInputBytes: 65536, maxOutputBytes: 65536, maxFrameBytes: 8192 },
});
test("historical replay is exact and inert; changed semantic request conflicts", () => {
  const journal = createLaunchJournal(expandFixtureRecipe(spec, policy), admission);
  expect(() => assertJournalReplay(journal, spec, policy)).not.toThrow();
  expect(() => parseLaunchSpec(spec, { ...admission, nowEpochMs: 61001 })).toThrow(
    "deadline_denied",
  );
  expect(() => assertJournalReplay(journal, spec, policy)).not.toThrow();
  for (const changed of [
    { ...spec, deadlineEpochMs: 61001 },
    { ...spec, leaseId: "changed" },
    { ...spec, fence: 2 },
    { ...spec, context: { ...spec.context, actorId: "other" } },
    { ...spec, context: { ...spec.context, configurationId: "other" } },
    { ...spec, budgets: { ...spec.budgets, maxInputBytes: 65535 } },
  ]) {
    expect(() => assertJournalReplay(journal, parseStoredLaunchSpec(changed), policy)).toThrow(
      "journal_conflict",
    );
  }
});
bunTest.skipIf(process.platform !== "darwin")(
  "production construction denies unsupported host without fake platform or filesystem",
  async () => {
    const lock = {
      root: "/var/lib/zetta-not-provisioned",
      uid: 1000,
      bunVersion: "1.3.14",
      bunRevision: "0d9b296af33f2b851fcbf4df3e9ec89751734ba4",
      flock: {
        sourceVersion: "2.39.3",
        sha256: "b991f23fbc6a3928a86977d87a6c4fd14acc44cfe90ce7cb8f5dcab4d8a49fbf",
        byteLength: 67816,
      },
    };
    await expect(openJournalStore({ lock, policy })).rejects.toThrow("capability_unavailable");
    await expect(
      openJournalStore({ lock: { ...lock, scope: { type: "admission" } }, policy }),
    ).rejects.toThrow("journal_invalid");
    await expect(openJournalStore({ lock, policy, skipProfile: true })).rejects.toThrow(
      "journal_invalid",
    );
  },
);

import { createJournalCallQueue } from "./journal-owner";
test("admission corruption must not close a separately owned valid receipt", async () => {
  let ownerClosed = false;
  const owner = createJournalCallQueue(async () => {
    ownerClosed = true;
  });
  let admissionClosed = false,
    fullySettled = false;
  const lifetime = createJournalStoreLifetime(async () => {
    admissionClosed = true;
  });
  lifetime.retain(owner);
  void lifetime.settled.then(() => {
    fullySettled = true;
  });
  const admissionQueue = lifetime.queue;
  await expect(
    admissionQueue.run(() => async () => {
      throw new Error("idle staging corruption");
    }),
  ).rejects.toThrow("journal_recovery_required");
  await admissionQueue.settled;
  try {
    expect(admissionClosed).toBe(true);
    expect(fullySettled).toBe(false);
    expect(ownerClosed).toBe(false);
    expect(await owner.run(() => async () => "valid owner progressed")).toBe(
      "valid owner progressed",
    );
  } finally {
    await lifetime.close();
  }
  expect(ownerClosed).toBe(true);
  expect(fullySettled).toBe(true);
});

test("explicit close after admission poison seals healthy owners synchronously and awaits held work", async () => {
  const held = Promise.withResolvers<void>();
  let released = false,
    settled = false;
  const owner = createJournalCallQueue(async () => {
    released = true;
  });
  const lifetime = createJournalStoreLifetime(async () => {});
  lifetime.retain(owner);
  const running = owner
    .run(() => async () => {
      await held.promise;
    })
    .catch((error) => error.message);
  await expect(
    lifetime.queue.run(() => async () => {
      throw new Error("corrupt idle receipt");
    }),
  ).rejects.toThrow("journal_recovery_required");
  await lifetime.queue.settled;
  void lifetime.settled.then(() => {
    settled = true;
  });
  const closing = lifetime.close();
  await expect(owner.run(() => async () => {})).rejects.toThrow("journal_closed");
  expect(released).toBe(false);
  expect(settled).toBe(false);
  held.resolve();
  expect(await running).toBe("journal_closed");
  await closing;
  expect(released).toBe(true);
  expect(settled).toBe(true);
});

test("whole-store cleanup awaits every owner even when another close fails", async () => {
  const held = Promise.withResolvers<void>();
  let secondClosed = false,
    allSettled = false;
  const first = createJournalCallQueue(async () => {
    throw new Error("private close failure");
  });
  const second = createJournalCallQueue(async () => {
    await held.promise;
    secondClosed = true;
  });
  const lifetime = createJournalStoreLifetime(async () => {});
  lifetime.retain(first);
  lifetime.retain(second);
  const closing = lifetime.close().catch((error) => {
    allSettled = true;
    return error.message;
  });
  await expect(first.settled).rejects.toThrow("journal_durability_unknown");
  expect(allSettled).toBe(false);
  expect(secondClosed).toBe(false);
  held.resolve();
  expect(await closing).toBe("journal_durability_unknown");
  expect(secondClosed).toBe(true);
});
