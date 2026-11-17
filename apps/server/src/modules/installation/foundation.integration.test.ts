// Wave 2 foundation, against a real database: the speech and push settings of the installation, the sealed keys read through the
// connection store, the config of a model on the person's own server, and the one-time claim of the push keys.
import { COMPATIBLE_NO_KEY } from "@zetta/core/model-server";
import { SPEECH_KEY_CONNECTION_PROVIDER } from "@zetta/core/speech";
import { PUSH_KEY_CONNECTION_PROVIDER } from "@zetta/core/push";
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { eq } from "@zetta/db/query";
import { connection } from "@zetta/db/schema/connections";
import { membership } from "@zetta/db/schema/identity";
import { userPreference } from "@zetta/db/schema/preferences";
import { pushSubscription } from "@zetta/db/schema/push";
import { pushModesFor } from "../preferences/push-mode";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createInstallationKeyReader } from "../connections/installation-key";
import { readCompatibleConfig, writeCompatibleConfig } from "../connections/compatible";
import { createConnectionsService, PROVIDERS } from "../connections/service";
import { createConnectionStore } from "../connections/store";
import { createMembershipLookup, issueBackgroundActor } from "../identity/access";
import { createPushReader } from "./push";
import { claimPushKeys, currentPushKeys } from "./push-keys";
import { createInstallationService, InvalidInstallationError, withLayaModel } from "./service";
import { createSpeechReader } from "./speech";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
// The connection store initializes a key check: only ever against the dedicated test database or the throwaway embedded one.
const suite =
  url && (url.endsWith("/zetta_test") || process.env.ZETTA_TEST_DB === "embedded")
    ? describe
    : describe.skip;
const ids = [`found-a-${uuidv7().slice(-8)}`, `found-b-${uuidv7().slice(-8)}`];
const [A, B] = ids as [string, string];
const KEY = Buffer.alloc(32, 7).toString("base64");

suite("wave 2 foundation: speech, push and model-server settings", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const installation = createInstallationService(db);
  const membershipLookup = createMembershipLookup(db);
  let connections: ReturnType<typeof createConnectionsService>;
  let keys: ReturnType<typeof createInstallationKeyReader>;
  const actor = async (id: string) => (await issueBackgroundActor(membershipLookup, id))!;
  const RESET = {
    speechProvider: "browser",
    speechBaseUrl: "",
    speechModel: "",
    speechVoice: "",
    speechLanguage: "",
    speechConnectionId: null,
    pushPublicKey: null,
    pushConnectionId: null,
  } as const;

  beforeAll(async () => {
    const store = await createConnectionStore(db, {
      configuration: { key: KEY, keyId: "v1" },
      allowedProviders: PROVIDERS,
      initializeEmpty: true,
    });
    connections = createConnectionsService(db, store);
    keys = createInstallationKeyReader({
      owner: async (id) =>
        (
          await db
            .select({ owner: connection.ownerUserId })
            .from(connection)
            .where(eq(connection.id, id))
        )[0]?.owner,
      actorFor: (userId) => issueBackgroundActor(membershipLookup, userId),
      connections,
    });
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(membership).values(
      ids.map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
    await installation.update({ ...RESET });
  });
  afterAll(async () => {
    await installation.update({ ...RESET });
    await cleanupTestUsers(db, ids).catch(() => undefined);
    await db.$client.end().catch(() => undefined);
  });

  test("the store accepts the new providers, and speech starts on the device's own voice", async () => {
    expect(PROVIDERS).toEqual(expect.arrayContaining(["speech", "push", "compatible"]));
    expect((await installation.load()).speechProvider).toBe("browser");
  });

  test("speech settings: validated, saved, and the address of a provider that takes none is dropped", async () => {
    await expect(installation.update({ speechProvider: "compatible" })).rejects.toBeInstanceOf(
      InvalidInstallationError,
    );
    await expect(installation.update({ speechVoice: "a b" })).rejects.toBeInstanceOf(
      InvalidInstallationError,
    );
    const saved = await installation.update({
      speechProvider: "compatible",
      speechBaseUrl: "https://tts.example.invalid/v1",
      speechModel: "tts-1",
      speechVoice: "alloy",
      speechLanguage: "pt",
    });
    expect(saved).toMatchObject({
      speechProvider: "compatible",
      speechBaseUrl: "https://tts.example.invalid/v1",
      speechModel: "tts-1",
      speechVoice: "alloy",
      speechLanguage: "pt",
    });
    expect(await installation.load()).toMatchObject({ speechVoice: "alloy" });
    const openai = await installation.update({ speechProvider: "openai" });
    expect(openai.speechBaseUrl).toBe("");
    expect(openai.speechModel).toBe("tts-1");
    await installation.update({ ...RESET });
  });

  test("the API view carries the speech settings and the public push key, and never the ids of the sealed keys", async () => {
    await installation.update({
      speechConnectionId: uuidv7(),
      pushConnectionId: uuidv7(),
      pushPublicKey: "B".repeat(87),
    });
    const view = withLayaModel(await installation.load());
    expect(view).toMatchObject({ speechProvider: "browser", pushPublicKey: "B".repeat(87) });
    const text = JSON.stringify(view);
    for (const field of ["transcribeConnectionId", "speechConnectionId", "pushConnectionId"])
      expect(Object.keys(view)).not.toContain(field);
    expect(text).not.toMatch(/ConnectionId/);
    await installation.update({ ...RESET });
  });

  test("a sealed key of the installation is read through its owner, and stops reading when it is revoked", async () => {
    const speech = createSpeechReader({ load: () => installation.load(), key: keys });
    expect(await speech.keyState()).toBe("none");
    expect(await speech.secret()).toBeUndefined();

    const admin = await actor(A);
    const made = await connections.create(admin, {
      provider: SPEECH_KEY_CONNECTION_PROVIDER,
      label: "Speech",
      secret: "sk-test-speech-0123456789",
    });
    await installation.update({ speechConnectionId: made.id });
    expect(await speech.keyState()).toBe("set");
    const secret = await speech.secret();
    expect(secret?.toString("utf8")).toBe("sk-test-speech-0123456789");
    secret?.fill(0);
    // A second read still works: the first buffer was a copy the caller could wipe.
    const again = await speech.secret();
    expect(again?.toString("utf8")).toBe("sk-test-speech-0123456789");

    await connections.revoke(admin, made.id, made.revision);
    expect(await speech.keyState()).toBe("unavailable");
    expect(await speech.secret()).toBeUndefined();
    await installation.update({ ...RESET });
  });

  test("push keys: the first claim wins, the second sees the winner, and other settings do not erase them", async () => {
    const admin = await actor(A);
    const push = createPushReader({ load: () => installation.load(), key: keys });
    expect(await push.publicKey()).toBeNull();
    expect(await push.privateKey()).toBeUndefined();

    const mk = (n: string) =>
      connections.create(admin, {
        provider: PUSH_KEY_CONNECTION_PROVIDER,
        label: `Push ${n}`,
        secret: `private-key-${n}-0123456789`,
      });
    const [one, two] = await Promise.all([mk("one"), mk("two")]);
    const results = await Promise.all([
      claimPushKeys(db, { publicKey: "P1".padEnd(87, "x"), connectionId: one!.id }),
      claimPushKeys(db, { publicKey: "P2".padEnd(87, "x"), connectionId: two!.id }),
    ]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const winner = results.findIndex((r) => r.claimed);
    const loser = results[1 - winner]!;
    const winning = [one!, two!][winner]!;
    expect(loser).toMatchObject({ claimed: false });
    expect(loser.claimed === false && loser.current?.connectionId).toBe(winning.id);
    expect(await currentPushKeys(db)).toMatchObject({ connectionId: winning.id });

    expect(await push.publicKey()).toBe(`P${winner + 1}`.padEnd(87, "x"));
    expect(await push.keyState()).toBe("set");
    const priv = await push.privateKey();
    expect(priv?.toString("utf8")).toBe(`private-key-${winner === 0 ? "one" : "two"}-0123456789`);

    // A later change of another setting keeps the pair; a third claim changes nothing.
    await installation.update({ speechModel: "tts-1" });
    expect((await installation.load()).pushPublicKey).toBe(`P${winner + 1}`.padEnd(87, "x"));
    expect(
      await claimPushKeys(db, { publicKey: "P3".padEnd(87, "x"), connectionId: one!.id }),
    ).toMatchObject({
      claimed: false,
    });
    await installation.update({ ...RESET });
  });

  test("a model on the person's own server: the address and name are the person's own, checked again on every read", async () => {
    const mine = await actor(A);
    const made = await connections.create(mine, {
      provider: "compatible",
      label: "Ollama on my laptop",
      secret: COMPATIBLE_NO_KEY,
    });
    // Before a config is written, the empty default is not a valid config.
    expect(await readCompatibleConfig(db, A, made.id, { allowLocal: true })).toEqual({
      ok: false,
      reason: { field: "config", issue: "config_invalid" },
    });
    const config = { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1:8b" };
    expect(await writeCompatibleConfig(db, A, made.id, config)).toBe(true);
    expect(await readCompatibleConfig(db, A, made.id, { allowLocal: true })).toEqual({
      ok: true,
      config,
      hostKind: "loopback",
    });
    // Who may reach a local address can change after the save: the rule runs again at the read.
    expect(await readCompatibleConfig(db, A, made.id, { allowLocal: false })).toEqual({
      ok: false,
      reason: { field: "baseUrl", issue: "local_not_allowed" },
    });
    // Somebody else's connection is not theirs to write or read, and a connection of another provider has no model config.
    expect(await writeCompatibleConfig(db, B, made.id, config)).toBe(false);
    expect(await readCompatibleConfig(db, B, made.id, { allowLocal: true })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const other = await connections.create(mine, {
      provider: "openai",
      label: "OpenAI",
      secret: "sk-test-0123456789",
    });
    expect(await writeCompatibleConfig(db, A, other.id, config)).toBe(false);
    // A stored address that the rule refuses (written by hand) never comes back as usable.
    await db
      .update(connection)
      .set({ configBaseUrl: "http://169.254.169.254/latest", configModel: "m" })
      .where(eq(connection.id, made.id));
    expect(await readCompatibleConfig(db, A, made.id, { allowLocal: true })).toEqual({
      ok: false,
      reason: { field: "baseUrl", issue: "blocked_address" },
    });
    // The secret is the placeholder, and the list the API returns carries no config.
    const secret = await connections.secretFor(mine, made.id);
    expect(secret.toString("utf8")).toBe(COMPATIBLE_NO_KEY);
    secret.fill(0);
    expect(JSON.stringify(await connections.list(mine))).not.toContain("169.254");
    // A revoked connection reads as gone.
    await writeCompatibleConfig(db, A, made.id, config);
    await connections.revoke(mine, made.id, made.revision);
    expect(await readCompatibleConfig(db, A, made.id, { allowLocal: true })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  test("a person's push subscriptions go when the person goes", async () => {
    const id = `found-c-${uuidv7().slice(-8)}`;
    await db.insert(user).values({
      id,
      name: id,
      email: `${id}@t.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(pushSubscription).values({
      userId: id,
      endpoint: `https://push.example.invalid/${uuidv7()}`,
      p256dh: "p256dh-key",
      auth: "auth-key",
    });
    expect(
      (await db.select().from(pushSubscription).where(eq(pushSubscription.userId, id))).length,
    ).toBe(1);
    await db.delete(user).where(eq(user.id, id));
    expect(
      (await db.select().from(pushSubscription).where(eq(pushSubscription.userId, id))).length,
    ).toBe(0);
  });

  test("the push choice of a person: the default until they choose, then theirs", async () => {
    const modes = await pushModesFor(db, [A, B]);
    expect([...modes]).toEqual([
      [A, "mentions_and_approvals"],
      [B, "mentions_and_approvals"],
    ]);
    await db.insert(userPreference).values({ ownerUserId: B, pushMode: "off" });
    const after = await pushModesFor(db, [A, B]);
    expect(after.get(A)).toBe("mentions_and_approvals");
    expect(after.get(B)).toBe("off");
    expect((await pushModesFor(db, [])).size).toBe(0);
  });
});
