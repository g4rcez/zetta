// The shared WhatsApp server: its address (the setting `wahaUrl`) and sealed key reach the plugin through `configureWhatsapp({ installation })`,
// read at every call. Order: the person's own plugin config, then the installation, then the built-in address with no key. The environment
// has no effect any more. The private-address rule is asked live, at every call.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PluginError, type PluginContext } from "./registry";
import {
  checkInstallationServer,
  configureWhatsapp,
  resetWhatsappLimits,
  WHATSAPP,
} from "./whatsapp";

const seen: { url: string; key: string | null }[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    seen.push({ url: new URL(req.url).pathname, key: req.headers.get("x-api-key") });
    const key = req.headers.get("x-api-key");
    if (new URL(req.url).pathname === "/api/sessions")
      return key === "shared-key" ? Response.json([]) : new Response("no", { status: 401 });
    return Response.json({ status: "WORKING" });
  },
});
afterAll(() => server.stop(true));
const own = `http://127.0.0.1:${server.port}`;
const ctx = (config: Record<string, string> = {}, userId = "u1"): PluginContext => ({
  userId,
  config,
  setConfig: async () => {},
});

beforeEach(() => {
  seen.length = 0;
  resetWhatsappLimits();
  configureWhatsapp({ allowPrivate: true });
});

describe("which WAHA server a call goes to", () => {
  test("the person's own address and key win over the installation's, which is never even read", async () => {
    let reads = 0;
    configureWhatsapp({
      allowPrivate: true,
      installation: async () => (
        reads++,
        { url: "http://shared.example.invalid", key: Buffer.from("shared-key") }
      ),
    });
    expect(await WHATSAPP.status!(ctx({ baseUrl: own, apiKey: "mine" }))).toEqual({
      state: "connected",
    });
    expect(seen[0]!.key).toBe("mine");
    expect(reads).toBe(0);
  });

  test("the installation's key is never sent to a person's own server that has no key of its own", async () => {
    configureWhatsapp({
      allowPrivate: true,
      installation: async () => ({
        url: "http://shared.example.invalid",
        key: Buffer.from("shared-key"),
      }),
    });
    await WHATSAPP.status!(ctx({ baseUrl: own }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBeNull();
  });

  test("with nothing of the person's, the installation's address and key are used, and the key bytes are zeroed", async () => {
    const key = Buffer.from("shared-key");
    configureWhatsapp({ allowPrivate: false, installation: async () => ({ url: own, key }) });
    expect(await WHATSAPP.status!(ctx())).toEqual({ state: "connected" });
    expect(seen[0]!.key).toBe("shared-key");
    expect([...key].every((b) => b === 0)).toBe(true);
  });

  test("a change of the installation's address or key applies at the next call, with no new configure", async () => {
    let state = { url: own, key: Buffer.from("shared-key") };
    configureWhatsapp({
      allowPrivate: false,
      installation: async () => ({ ...state, key: Buffer.from(state.key) }),
    });
    await WHATSAPP.status!(ctx());
    expect(seen[0]!.key).toBe("shared-key");
    state = { url: own, key: Buffer.from("rotated") };
    await WHATSAPP.status!(ctx());
    expect(seen[1]!.key).toBe("rotated");
  });

  test("an empty installation address means the built-in one, with no key sent", async () => {
    const real = globalThis.fetch;
    const urls: { url: string; key: string | null }[] = [];
    globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
      urls.push({ url: String(input), key: new Headers(init?.headers).get("x-api-key") });
      return Response.json({ status: "WORKING" });
    }) as typeof fetch;
    try {
      configureWhatsapp({
        allowPrivate: false,
        installation: async () => ({ url: "", key: undefined }),
      });
      await WHATSAPP.status!(ctx());
      configureWhatsapp({ allowPrivate: false });
      await WHATSAPP.status!(ctx());
    } finally {
      globalThis.fetch = real;
    }
    expect(urls.map((u) => new URL(u.url).origin)).toEqual([
      "http://127.0.0.1:3010",
      "http://127.0.0.1:3010",
    ]);
    expect(urls.map((u) => u.key)).toEqual([null, null]);
  });

  test("the environment has no effect", async () => {
    const saved = [process.env.ZETTA_WAHA_URL, process.env.ZETTA_WAHA_API_KEY];
    process.env.ZETTA_WAHA_URL = own;
    process.env.ZETTA_WAHA_API_KEY = "from-env";
    const real = globalThis.fetch;
    const urls: { url: string; key: string | null }[] = [];
    globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
      urls.push({ url: String(input), key: new Headers(init?.headers).get("x-api-key") });
      return Response.json({ status: "WORKING" });
    }) as typeof fetch;
    try {
      configureWhatsapp({
        allowPrivate: false,
        installation: async () => ({ url: "", key: undefined }),
      });
      await WHATSAPP.status!(ctx());
    } finally {
      globalThis.fetch = real;
      for (const [name, v] of [
        ["ZETTA_WAHA_URL", saved[0]],
        ["ZETTA_WAHA_API_KEY", saved[1]],
      ] as const)
        if (v === undefined) delete process.env[name];
        else process.env[name] = v;
    }
    expect(new URL(urls[0]!.url).origin).toBe("http://127.0.0.1:3010");
    expect(urls[0]!.key).toBeNull();
    expect(seen).toHaveLength(0);
  });

  test("when the installation's settings cannot be read the call fails; it does not fall back to the built-in server", async () => {
    configureWhatsapp({
      allowPrivate: true,
      installation: async () => {
        throw new Error("database down");
      },
    });
    await expect(WHATSAPP.install!(ctx())).rejects.toMatchObject({ code: "UNREACHABLE" });
    expect(seen).toHaveLength(0);
  });
});

describe("the private-address rule is live", () => {
  test("a person's own private address is refused, allowed when the setting is turned on, refused again when turned off, with no restart", async () => {
    let allowed = false;
    configureWhatsapp({ allowPrivate: async () => allowed });
    const run = () => WHATSAPP.status!(ctx({ baseUrl: own, apiKey: "k" }));
    // `status` reports a blocked address as an error state; `install` throws it.
    await expect(WHATSAPP.install!(ctx({ baseUrl: own }))).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
    expect((await run()).state).toBe("error");
    expect(seen).toHaveLength(0);
    allowed = true;
    expect(await run()).toEqual({ state: "connected" });
    expect(seen).toHaveLength(1);
    allowed = false;
    await expect(WHATSAPP.install!(ctx({ baseUrl: own }))).rejects.toBeInstanceOf(PluginError);
    expect(seen).toHaveLength(1);
  });

  test("a policy that cannot answer refuses (fails closed)", async () => {
    configureWhatsapp({
      allowPrivate: async () => {
        throw new Error("settings unreadable");
      },
    });
    await expect(WHATSAPP.install!(ctx({ baseUrl: own }))).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
    expect(seen).toHaveLength(0);
  });
});

describe("the Test button's check", () => {
  test("accepts the saved key, and says so when the server refuses it or wants one", async () => {
    configureWhatsapp({ installation: async () => ({ url: own, key: Buffer.from("shared-key") }) });
    expect(await checkInstallationServer()).toMatchObject({ ok: true });
    configureWhatsapp({ installation: async () => ({ url: own, key: Buffer.from("wrong") }) });
    expect(await checkInstallationServer()).toMatchObject({
      ok: false,
      message: expect.stringContaining("did not accept"),
    });
    configureWhatsapp({ installation: async () => ({ url: own, key: undefined }) });
    expect(await checkInstallationServer()).toMatchObject({
      ok: false,
      message: expect.stringContaining("wants a key"),
    });
    expect(seen.every((s) => s.url === "/api/sessions")).toBe(true);
  });
  test("an unreadable setting or an address that is not http(s) is a plain failure", async () => {
    configureWhatsapp({
      installation: async () => {
        throw new Error("x");
      },
    });
    expect((await checkInstallationServer()).ok).toBe(false);
    configureWhatsapp({ installation: async () => ({ url: "ftp://x", key: undefined }) });
    expect((await checkInstallationServer()).ok).toBe(false);
  });
});
