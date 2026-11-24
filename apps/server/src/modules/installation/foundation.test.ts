import { describe, expect, test } from "bun:test";
import { createInstallationKeyReader } from "../connections/installation-key";
import { createPushReader } from "./push";
import { createSpeechReader, speechSettingsOf } from "./speech";
import { fakeInstallationKeys, fakeInstallationSettings } from "./testing";
import { withLayaModel } from "./service";

const actor = { userId: "owner", isAdmin: true } as never;

describe("the reader of a sealed installation key", () => {
  const secrets = new Map([["c1", "sk-test-0123456789"]]);
  const reader = (o: { owner?: string | undefined; member?: boolean } = {}) =>
    createInstallationKeyReader({
      owner: async (id) => (secrets.has(id) ? (o.owner ?? "owner") : undefined),
      actorFor: async () => (o.member === false ? null : actor),
      connections: {
        list: async () => [{ id: "c1", state: "active" }] as never,
        secretFor: async (_a: never, id: string) => {
          const s = secrets.get(id);
          if (!s) throw new Error("not-found");
          return Buffer.from(s);
        },
      } as never,
    });

  test("no connection recorded: no key, and the removed key variables are not a source", async () => {
    expect(await reader().state(null)).toBe("none");
    expect(await reader().secret(null)).toBeUndefined();
    process.env.ZETTA_TRANSCRIBE_API_KEY = "sk-test-from-env";
    process.env.ZETTA_SPEECH_API_KEY = "sk-test-from-env";
    try {
      expect(await reader().state(null)).toBe("none");
      expect(await reader().secret(null)).toBeUndefined();
    } finally {
      delete process.env.ZETTA_TRANSCRIBE_API_KEY;
      delete process.env.ZETTA_SPEECH_API_KEY;
    }
  });
  test("a saved key is read through its owner", async () => {
    expect(await reader().state("c1")).toBe("set");
    expect((await reader().secret("c1"))?.toString()).toBe("sk-test-0123456789");
  });
  test("an owner who left, a missing row or an unreadable key is unavailable and never throws", async () => {
    expect(await reader({ member: false }).state("c1")).toBe("unavailable");
    expect(await reader({ member: false }).secret("c1")).toBeUndefined();
    expect(await reader().state("gone")).toBe("unavailable");
    expect(await reader().secret("gone")).toBeUndefined();
    const broken = createInstallationKeyReader({
      owner: async () => "owner",
      actorFor: async () => actor,
      connections: {
        list: async () => [{ id: "c1", state: "active" }] as never,
        secretFor: () => {
          throw new Error("CONNECTIONS_UNAVAILABLE");
        },
      } as never,
    });
    expect(await broken.secret("c1")).toBeUndefined();
  });
});

describe("the readers of speech and push", () => {
  test("speech reads the settings and the key on every call", async () => {
    let settings = fakeInstallationSettings({ speechProvider: "openai", speechConnectionId: "k1" });
    const keys = fakeInstallationKeys({ keys: { k1: "sk-test-speech" } });
    const speech = createSpeechReader({ load: async () => settings, key: keys });
    expect(await speech.settings()).toEqual({
      speechProvider: "openai",
      speechBaseUrl: "",
      speechModel: "",
      speechVoice: "",
      speechLanguage: "",
    });
    expect(await speech.keyState()).toBe("set");
    const secret = await speech.secret();
    expect(secret?.toString()).toBe("sk-test-speech");
    secret?.fill(0);
    expect((await speech.secret())?.toString()).toBe("sk-test-speech");
    settings = fakeInstallationSettings({ speechProvider: "browser" });
    expect((await speech.settings()).speechProvider).toBe("browser");
    expect(await speech.keyState()).toBe("none");
  });
  test("push has no key until one is generated", async () => {
    let settings = fakeInstallationSettings();
    const push = createPushReader({
      load: async () => settings,
      key: fakeInstallationKeys({ keys: { p1: "private-key" } }),
    });
    expect(await push.publicKey()).toBeNull();
    expect(await push.privateKey()).toBeUndefined();
    expect(await push.keyState()).toBe("none");
    settings = fakeInstallationSettings({ pushPublicKey: "pub", pushConnectionId: "p1" });
    expect(await push.publicKey()).toBe("pub");
    expect((await push.privateKey())?.toString()).toBe("private-key");
  });
  test("the fake reports a key whose owner left as unavailable", async () => {
    const keys = fakeInstallationKeys({ keys: { k: "x" }, unreadable: ["k"] });
    expect(await keys.state("k")).toBe("unavailable");
    expect(await keys.secret("k")).toBeUndefined();
  });
});

describe("what the API returns", () => {
  test("the ids of the sealed keys are removed; the settings and the public key stay", () => {
    const settings = fakeInstallationSettings({
      speechConnectionId: "s1",
      pushConnectionId: "p1",
      transcribeConnectionId: "t1",
      pushPublicKey: "pub",
      speechProvider: "elevenlabs",
      speechVoice: "voice-id",
    });
    const view = withLayaModel(settings) as Record<string, unknown>;
    expect(view.speechProvider).toBe("elevenlabs");
    expect(view.speechVoice).toBe("voice-id");
    expect(view.pushPublicKey).toBe("pub");
    for (const hidden of ["speechConnectionId", "pushConnectionId", "transcribeConnectionId"])
      expect(hidden in view).toBe(false);
    expect(speechSettingsOf(settings)).not.toHaveProperty("speechConnectionId");
  });
});
