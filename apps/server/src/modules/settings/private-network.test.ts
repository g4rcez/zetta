// The private-network policy (setting `allowPrivateNetwork`) is asked at every check: a request to a private address is refused while the
// setting is off, allowed the moment it is turned on, refused again when it is turned off, all in one process with no restart, and the old
// variable has no effect. Each module below is given the one policy object that services.ts builds from the settings service.
import { afterAll, describe, expect, test } from "bun:test";
import { createRemoteSynthesizer } from "../speech/remote";
import { SpeechError } from "../speech/errors";
import { createRemoteTranscriber } from "../transcribe/remote";
import { TranscribeError } from "../transcribe/transcriber";
import { createUpdateChecker } from "../updates/checker";
import { assertPublicUrl } from "../computer/service";
import { assertMailHosts, configureMailPolicy } from "../mail/imap-connect";
import { BITWARDEN } from "../integrations/plugins/vault/bitwarden";
import { configureVault } from "../integrations/plugins/vault/exec";
import { configureWhatsapp, WHATSAPP } from "../integrations/plugins/whatsapp";
import { configureHomeAssistant } from "../integrations/plugins/homeassistant";
import { createMachineService } from "../computer/machines";
import { createPrivateNetworkPolicy, privateAllowed, privateAllowedNow } from "./private-network";
import { createSettingsService } from "./service";
import { createMemorySettingsStore, createTestSettings } from "./testing";

const setup = () => {
  const t = createTestSettings();
  const policy = createPrivateNetworkPolicy(t.service);
  return { ...t, policy };
};
const PRIVATE = "127.0.0.1";

describe("the policy object", () => {
  test("off by default, on when stored, off again when reset; the old variable has no effect", async () => {
    const saved = process.env.ZETTA_ALLOW_PRIVATE_NETWORK;
    try {
      const { policy, set, unset } = setup();
      process.env.ZETTA_ALLOW_PRIVATE_NETWORK = "1";
      expect(await policy.allowed()).toBe(false);
      await set("allowPrivateNetwork", "on");
      expect(await policy.allowed()).toBe(true);
      process.env.ZETTA_ALLOW_PRIVATE_NETWORK = "0";
      expect(await policy.allowed()).toBe(true);
      await set("allowPrivateNetwork", "off");
      expect(await policy.allowed()).toBe(false);
      await set("allowPrivateNetwork", "on");
      await unset("allowPrivateNetwork");
      expect(await policy.allowed()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.ZETTA_ALLOW_PRIVATE_NETWORK;
      else process.env.ZETTA_ALLOW_PRIVATE_NETWORK = saved;
    }
  });

  test("fails closed: a settings read that throws is a no, for the async and the synchronous answer", async () => {
    const store = createMemorySettingsStore();
    const service = createSettingsService({ store, warn: () => undefined });
    const policy = createPrivateNetworkPolicy(service);
    await service.warm();
    store.readScope = async () => {
      throw new Error("database down");
    };
    service.invalidate();
    expect(await policy.allowed()).toBe(false);
    expect(policy.current()).toBe(false);
    expect(await privateAllowed(() => Promise.reject(new Error("x")))).toBe(false);
    expect(await privateAllowed(undefined)).toBe(false);
    expect(await privateAllowed(true)).toBe(true);
    expect(privateAllowedNow(() => true)).toBe(true);
    expect(privateAllowedNow(async () => true)).toBe(false);
  });
});

describe("the synchronous answer (peek) of the settings service", () => {
  test("never read: unknown; after warm: the value; fresh for the time-to-live, then refreshed in the background; too old: unknown again", async () => {
    let clock = 1_000_000;
    const store = createMemorySettingsStore();
    const service = createSettingsService({ store, now: () => clock, ttlMs: 5000 });
    expect(service.peek("allowPrivateNetwork")).toBeUndefined();
    await service.warm();
    expect(service.peek("allowPrivateNetwork")).toBe("off");
    await store.upsert({ kind: "installation" }, "allowPrivateNetwork", "on", "someone");
    // Within the time-to-live the rows in hand answer.
    expect(service.peek("allowPrivateNetwork")).toBe("off");
    // Past it, the old rows answer once while a refresh runs, and the next call sees the new value.
    clock += 6000;
    expect(service.peek("allowPrivateNetwork")).toBe("off");
    await Bun.sleep(10);
    expect(service.peek("allowPrivateNetwork")).toBe("on");
    // The database stops answering: the last rows serve for three more time-to-lives, then the answer is unknown.
    store.readScope = async () => {
      throw new Error("down");
    };
    clock += 6000;
    expect(service.peek("allowPrivateNetwork")).toBe("on");
    clock += 15_000;
    expect(service.peek("allowPrivateNetwork")).toBeUndefined();
  });

  test("a write through the service applies to the next synchronous answer at once", async () => {
    const { service, set } = createTestSettings();
    await service.warm();
    expect(service.peek("allowPrivateNetwork")).toBe("off");
    await set("allowPrivateNetwork", "on");
    expect(service.peek("allowPrivateNetwork")).toBe("on");
  });
});

describe("a request to a private address, module by module, with no restart", () => {
  test("speech to text provider address", async () => {
    const { policy, set } = setup();
    let calls = 0;
    const t = createRemoteTranscriber({
      allowPrivate: policy.allowed,
      fetch: (async () => (calls++, Response.json({ text: "hi" }))) as unknown as typeof fetch,
      resolve: async () => ({
        provider: "compatible",
        baseUrl: `http://${PRIVATE}:9/v1`,
        model: "",
        key: Buffer.from("k"),
      }),
    });
    const pcm = new Float32Array(16_000);
    await expect(t.transcribe(pcm)).rejects.toBeInstanceOf(TranscribeError);
    expect(calls).toBe(0);
    await set("allowPrivateNetwork", "on");
    expect(await t.transcribe(pcm)).toBe("hi");
    expect(calls).toBe(1);
    await set("allowPrivateNetwork", "off");
    await expect(t.transcribe(pcm)).rejects.toBeInstanceOf(TranscribeError);
    expect(calls).toBe(1);
  });

  test("text to speech provider address", async () => {
    const { policy, set } = setup();
    let calls = 0;
    const s = createRemoteSynthesizer({
      allowPrivate: policy.allowed,
      fetch: (async () => (calls++, new Response(new Uint8Array(4800)))) as unknown as typeof fetch,
      resolve: async () => ({
        provider: "compatible",
        baseUrl: `http://${PRIVATE}:9/v1`,
        model: "",
        voice: "",
        key: Buffer.from("k"),
      }),
    });
    const code = (p: Promise<unknown>) =>
      p.then(
        () => "none",
        (e: unknown) => (e instanceof SpeechError ? e.code : "other"),
      );
    expect(await code(s.synthesize("hello"))).toBe("NOT_CONFIGURED");
    expect(calls).toBe(0);
    await set("allowPrivateNetwork", "on");
    expect(await code(s.synthesize("hello"))).toBe("none");
    expect(calls).toBe(1);
    await set("allowPrivateNetwork", "off");
    expect(await code(s.synthesize("hello"))).toBe("NOT_CONFIGURED");
    expect(calls).toBe(1);
  });

  test("the update feed", async () => {
    const { policy, set } = setup();
    let clock = Date.parse("2026-11-16T00:00:00Z");
    let calls = 0;
    const checker = createUpdateChecker({
      build: { commit: "54121d6", date: "2026-11-10T12:00:00.000Z" },
      feedUrl: `http://${PRIVATE}:9/changelog.json`,
      mode: async () => "on",
      now: () => clock,
      allowPrivate: policy.allowed,
      assertPublic: assertPublicUrl,
      fetch: (async () => (calls++, Response.json([]))) as unknown as typeof fetch,
    });
    const day = 25 * 3_600_000;
    await checker.tick();
    expect(calls).toBe(0);
    await set("allowPrivateNetwork", "on");
    clock += day;
    await checker.tick();
    expect(calls).toBe(1);
    await set("allowPrivateNetwork", "off");
    clock += day;
    await checker.tick();
    expect(calls).toBe(1);
  });

  test("a mail server host", async () => {
    const { policy, set } = setup();
    configureMailPolicy({ allowPrivate: policy.allowed });
    try {
      await expect(assertMailHosts([PRIVATE])).rejects.toMatchObject({ code: "BLOCKED_URL" });
      await set("allowPrivateNetwork", "on");
      await expect(assertMailHosts([PRIVATE])).resolves.toBeUndefined();
      await set("allowPrivateNetwork", "off");
      await expect(assertMailHosts([PRIVATE])).rejects.toMatchObject({ code: "BLOCKED_URL" });
    } finally {
      configureMailPolicy({ allowPrivate: false });
    }
  });

  test("the vault adapters (Bitwarden server address)", async () => {
    const { policy, set } = setup();
    const argvs: string[][] = [];
    configureVault({
      allowPrivate: policy.allowed,
      exec: async (argv) => {
        argvs.push(argv);
        return { code: 1, stdout: "", stderr: "stop here" };
      },
    });
    try {
      const ctx = {
        userId: "u",
        setConfig: async () => {},
        config: {
          clientId: "user.abc",
          clientSecret: "cs",
          masterPassword: "pw",
          serverUrl: `http://${PRIVATE}:8080`,
        },
      };
      const blocked = (await BITWARDEN.install!(ctx).catch((e) => e)) as { code: string };
      expect(blocked.code).toBe("BLOCKED_URL");
      expect(argvs).toHaveLength(0);
      await set("allowPrivateNetwork", "on");
      // Allowed now: the address check passes, and the call stops later for another reason (the CLI here refuses), never BLOCKED_URL.
      const passed = (await BITWARDEN.install!(ctx).catch((e) => e)) as { code?: string };
      expect(passed.code).not.toBe("BLOCKED_URL");
      const after = argvs.length;
      await set("allowPrivateNetwork", "off");
      const again = (await BITWARDEN.install!(ctx).catch((e) => e)) as { code: string };
      expect(again.code).toBe("BLOCKED_URL");
      expect(argvs).toHaveLength(after);
    } finally {
      configureVault({ allowPrivate: false });
    }
  });

  test("a WhatsApp server the person typed", async () => {
    const { policy, set } = setup();
    configureWhatsapp({ allowPrivate: policy.allowed });
    const ctx = {
      userId: "u",
      setConfig: async () => {},
      config: { baseUrl: `http://${PRIVATE}:9` },
    };
    try {
      await expect(WHATSAPP.install!(ctx)).rejects.toMatchObject({ code: "BLOCKED_URL" });
      await set("allowPrivateNetwork", "on");
      await expect(WHATSAPP.install!(ctx)).resolves.toBeUndefined();
      await set("allowPrivateNetwork", "off");
      await expect(WHATSAPP.install!(ctx)).rejects.toMatchObject({ code: "BLOCKED_URL" });
    } finally {
      configureWhatsapp({ allowPrivate: false });
    }
  });

  test("a Home Assistant server", async () => {
    const { policy, set } = setup();
    configureHomeAssistant({ allowPrivate: policy.allowed });
    const { HOME_ASSISTANT, haFetch } = await import("../integrations/plugins/homeassistant");
    void HOME_ASSISTANT;
    const ctx = {
      userId: "u",
      setConfig: async () => {},
      config: { baseUrl: `http://${PRIVATE}:9`, token: "t" },
    };
    try {
      await expect(haFetch(ctx, "/api/")).rejects.toMatchObject({ code: "BLOCKED_URL" });
      await set("allowPrivateNetwork", "on");
      // Allowed now: the call goes out and finds nothing listening on that port (an unreachable error, not a blocked one).
      await expect(haFetch(ctx, "/api/")).rejects.not.toMatchObject({ code: "BLOCKED_URL" });
      await set("allowPrivateNetwork", "off");
      await expect(haFetch(ctx, "/api/")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    } finally {
      configureHomeAssistant({ allowPrivate: false });
    }
  });

  test("a machine host (ssh, sftp, ftp)", async () => {
    const { policy, set } = setup();
    const scanned: string[] = [];
    const svc = createMachineService({
      db: {} as never,
      connections: {} as never,
      runner: { scan: async (ip: string) => (scanned.push(ip), []) } as never,
      allowPrivate: policy.allowed,
      resolve: async () => [PRIVATE],
    });
    await expect(svc.scan("box.example.invalid", 22)).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
    await expect(svc.scan("localhost", 22)).rejects.toMatchObject({ code: "BLOCKED_URL" });
    expect(scanned).toEqual([]);
    await set("allowPrivateNetwork", "on");
    await svc.scan("box.example.invalid", 22);
    expect(scanned).toEqual([PRIVATE]);
    await set("allowPrivateNetwork", "off");
    await expect(svc.scan("box.example.invalid", 22)).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
    expect(scanned).toEqual([PRIVATE]);
  });
});

afterAll(() => {
  configureMailPolicy({ allowPrivate: false });
});
