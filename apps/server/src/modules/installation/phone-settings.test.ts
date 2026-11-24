// The "Phone numbers" settings of the installation, through the real routes: who may change them, what the answer holds (never the key's
// connection), what the Test button reports, the key route, and GET /api/voice/capabilities. The saved row's rules are in
// phone-settings.integration.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_PHONE_SETTINGS,
  normalizeCountries,
  normalizePublicUrl,
  phoneSettingsIssue,
} from "@zetta/core/phone";
import { Elysia } from "elysia";
import { createApp } from "../../app";
import { createConnectionRoutes } from "../connections/routes";
import { createIdentityAccess } from "../identity/access";
import { createPhoneProviderReader } from "../phone/config";
import { startFakeTelnyx } from "../phone/fake";
import { createTelnyxProvider } from "../phone/telnyx";
import { createVoiceRoutes } from "../voice/routes";
import { fakeInstallationKeys, fakeInstallationSettings } from "./testing";
import { InvalidInstallationError, type InstallationSettings } from "./service";

const origin = "https://app.example.invalid";
const KEY_ID = "11111111-1111-7111-8111-111111111111";
const fake = startFakeTelnyx();
afterAll(() => fake.stop());

const good = {
  phoneProvider: "telnyx",
  phonePublicKey: fake.publicKey,
  phonePublicUrl: "https://zetta.example.invalid",
  phoneApplicationId: fake.connectionRef,
  phoneRequestMode: "owner_request",
  phoneCountries: "br, us",
} as const;

function app(o: { key?: string | null; saved?: Partial<InstallationSettings> } = {}) {
  let saved: InstallationSettings = fakeInstallationSettings({
    phoneConnectionId: o.key === null ? null : KEY_ID,
    ...o.saved,
  });
  const keys = fakeInstallationKeys({ keys: { [KEY_ID]: fake.apiKey } });
  const reader = createPhoneProviderReader({
    load: async () => saved,
    key: keys,
    create: (s, apiKey) =>
      createTelnyxProvider({
        apiKey,
        publicKey: s.phonePublicKey,
        connectionRef: s.phoneApplicationId,
        baseUrl: fake.baseUrl,
      }),
  });
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("cookie");
        return id
          ? { user: { id, name: id, email: `${id}@example.invalid` }, session: { id: "s" } }
          : null;
      },
    },
    handler: () => new Response("auth"),
  };
  const access = createIdentityAccess(auth as never, async (id) => ({ isAdmin: id === "admin" }));
  const installation = {
    load: async () => saved,
    update: async (patch: Partial<InstallationSettings>) => {
      const next = { ...saved, ...patch };
      next.phoneCountries = normalizeCountries(next.phoneCountries);
      const issue = phoneSettingsIssue(next);
      if (issue) throw new InvalidInstallationError(issue);
      return (saved = next);
    },
  };
  const addressChecks: string[] = [];
  const a = createApp({
    auth: auth as never,
    installation: {
      access,
      installation: installation as never,
      runningMode: "local",
      phone: {
        reader,
        key: keys,
        address: async (raw) => {
          addressChecks.push(raw);
          return raw.startsWith("https://")
            ? { ok: true, message: "The public address answers." }
            : { ok: false, message: "The public address must be an https address." };
        },
      },
    },
    webOrigin: origin,
    desktopOrigins: [],
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await a.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { origin, cookie: as, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, text: await r.text() };
  };
  return { call, reader, access, current: () => saved, addressChecks };
}

describe("reading", () => {
  test("members read the choice and whether a key is there, never the key's connection", async () => {
    const t = app();
    const r = await t.call("member", "GET", "/api/installation");
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(body).toMatchObject({ ...DEFAULT_PHONE_SETTINGS, phoneKey: "set" });
    expect(r.text).not.toContain(KEY_ID);
    expect(Object.keys(body).filter((k) => /connectionid/i.test(k))).toEqual([]);
  });
  test("no key reads as none", async () => {
    const t = app({ key: null });
    expect(JSON.parse((await t.call("member", "GET", "/api/installation")).text).phoneKey).toBe(
      "none",
    );
  });
});

describe("saving", () => {
  test("an administrator chooses Telnyx with its pieces, countries saved as upper case codes", async () => {
    const t = app();
    const r = await t.call("admin", "PATCH", "/api/installation", good);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({
      phoneProvider: "telnyx",
      phoneCountries: "BR,US",
      phonePublicUrl: "https://zetta.example.invalid",
      phoneRequestMode: "owner_request",
    });
    expect(r.text).not.toContain(KEY_ID);
  });
  test("limits are saved within their ranges", async () => {
    const t = app();
    const r = await t.call("admin", "PATCH", "/api/installation", {
      phoneMaxNumbers: 3,
      phoneMaxCallMinutes: 10,
      phoneDailyMinutesPerBot: 45,
      phoneDailyCallsPerBot: 7,
    });
    expect(JSON.parse(r.text)).toMatchObject({
      phoneMaxNumbers: 3,
      phoneMaxCallMinutes: 10,
      phoneDailyMinutesPerBot: 45,
      phoneDailyCallsPerBot: 7,
    });
    for (const bad of [
      { phoneMaxNumbers: 1001 },
      { phoneMaxCallMinutes: 0 },
      { phoneDailyMinutesPerBot: 1441 },
      { phoneDailyCallsPerBot: -1 },
      { phoneMaxNumbers: 1.5 },
    ])
      expect((await t.call("admin", "PATCH", "/api/installation", bad)).status).toBe(400);
  });
  test("a member cannot, and nothing changes", async () => {
    const t = app();
    expect((await t.call("member", "PATCH", "/api/installation", good)).status).toBe(403);
    expect(t.current().phoneProvider).toBe("off");
  });
  test("a provider needs its key, address and application; an unknown provider, mode, address or country is refused", async () => {
    const t = app();
    expect(
      (await t.call("admin", "PATCH", "/api/installation", { phoneProvider: "telnyx" })).status,
    ).toBe(400);
    for (const bad of [
      { phoneProvider: "twilio" },
      { phoneRequestMode: "anyone" },
      { phonePublicUrl: "http://zetta.example.invalid" },
      { phoneApplicationId: "has space" },
      { phoneUnknown: 1 },
    ])
      expect((await t.call("admin", "PATCH", "/api/installation", bad)).status).toBe(400);
    expect(t.current().phoneProvider).toBe("off");
  });
  test("the settings rules in one place", () => {
    expect(phoneSettingsIssue({ ...DEFAULT_PHONE_SETTINGS })).toBeNull();
    expect(
      phoneSettingsIssue({
        ...DEFAULT_PHONE_SETTINGS,
        phonePublicUrl: "https://a.example.invalid/path",
      }),
    ).not.toBeNull();
    expect(
      phoneSettingsIssue({ ...DEFAULT_PHONE_SETTINGS, phoneCountries: "brazil" }),
    ).not.toBeNull();
    expect(normalizePublicUrl("https://Zetta.Example.invalid/")).toBe(
      "https://zetta.example.invalid",
    );
    expect(normalizePublicUrl("http://zetta.example.invalid")).toBeUndefined();
    expect(normalizePublicUrl("https://user:pw@zetta.example.invalid")).toBeUndefined();
    expect(normalizeCountries(" br ; us,BR, xyz ")).toBe("BR,US");
  });
});

describe("the Test button", () => {
  const set = (t: ReturnType<typeof app>) => t.call("admin", "PATCH", "/api/installation", good);
  test("administrators only", async () => {
    const t = app();
    await set(t);
    expect((await t.call("member", "POST", "/api/installation/phone/test")).status).toBe(403);
  });
  test("off asks to choose a provider; no key asks for the key", async () => {
    expect(
      JSON.parse((await app().call("admin", "POST", "/api/installation/phone/test")).text).ok,
    ).toBe(false);
    const t = app({ key: null });
    await set(t);
    expect(
      JSON.parse((await t.call("admin", "POST", "/api/installation/phone/test")).text).message,
    ).toContain("key");
  });
  test("a working key, application and address say so, and the balance is shown", async () => {
    const t = app();
    await set(t);
    const body = JSON.parse((await t.call("admin", "POST", "/api/installation/phone/test")).text);
    expect(body).toMatchObject({
      ok: true,
      keyOk: true,
      applicationOk: true,
      balance: "10.00 USD",
    });
    expect(t.addressChecks).toEqual(["https://zetta.example.invalid"]);
  });
  test("an unknown call application, and an address that fails, are named", async () => {
    const t = app();
    await set(t);
    await t.call("admin", "PATCH", "/api/installation", { phoneApplicationId: "999" });
    const bad = JSON.parse((await t.call("admin", "POST", "/api/installation/phone/test")).text);
    expect(bad).toMatchObject({ ok: false, keyOk: true, applicationOk: false });
    expect(bad.message).toContain("call application");
  });
  test("a provider that is down gives a fixed sentence, never its words", async () => {
    const t = app();
    await set(t);
    fake.failNext(503);
    const body = JSON.parse((await t.call("admin", "POST", "/api/installation/phone/test")).text);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Try again");
  });
});

describe("the key route", () => {
  const sealedSecret = "KEY-test-0000000000";
  const recorded: (string | null)[] = [];
  const created: { provider: string; label: string; secret: string }[] = [];
  const t = app();
  const connections = {
    configured: () => true,
    list: async () => [],
    create: async (_a: unknown, v: { provider: string; label: string; secret: string }) => {
      created.push(v);
      return {
        id: "c0000000-0000-7000-8000-000000000001",
        provider: v.provider,
        label: v.label,
        state: "active",
        revision: 1,
      };
    },
  } as never;
  const opened: { userId: string; purpose: string }[] = [];
  const keyring = {
    publicKey: async () => ({}),
    open: async (sealed: unknown, ctx: { userId: string; purpose: string }) => {
      opened.push(ctx);
      return sealed;
    },
  } as never;
  const routes = () =>
    new Elysia().use(
      createConnectionRoutes(
        { access: t.access, connections, phoneKey: { set: async (id) => void recorded.push(id) } },
        [origin],
        keyring,
      ),
    );
  const call = (as: string, method: string, body?: unknown) =>
    routes().handle(
      new Request("http://localhost/api/connections/phone-key", {
        method,
        headers: { origin, cookie: as, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  test("an administrator seals the key for its own purpose and the connection is recorded", async () => {
    const r = await call("admin", "PUT", { sealed: { secret: sealedSecret } });
    expect(r.status).toBe(200);
    expect(opened).toEqual([{ userId: "admin", purpose: "installation.phone-key" }]);
    expect(created).toEqual([{ provider: "phone", label: "Phone numbers", secret: sealedSecret }]);
    expect(recorded).toEqual(["c0000000-0000-7000-8000-000000000001"]);
    expect(await r.text()).not.toContain(sealedSecret);
  });
  test("a member cannot save or remove it, and removing clears the record", async () => {
    expect((await call("member", "PUT", { sealed: { secret: sealedSecret } })).status).toBe(403);
    expect((await call("member", "DELETE")).status).toBe(403);
    expect(created.length).toBe(1);
    expect((await call("admin", "DELETE")).status).toBe(200);
    expect(recorded.at(-1)).toBeNull();
  });
  test("a key too short is refused", async () => {
    expect((await call("admin", "PUT", { sealed: { secret: "short" } })).status).toBe(400);
  });
});

describe("GET /api/voice/capabilities", () => {
  const voiceApp = (state: Partial<InstallationSettings>, keyId: string | null = KEY_ID) => {
    const t = app({ saved: state, key: keyId });
    const voice = {
      capabilities: async () => ({
        voice: "on" as const,
        phone: (await t.reader.offer()).on ? ("on" as const) : ("off" as const),
      }),
    } as never;
    return new Elysia().use(createVoiceRoutes({ access: t.access, voice }, [origin]) as never);
  };
  const read = async (a: ReturnType<typeof voiceApp>) =>
    JSON.parse(
      await (
        await a.handle(
          new Request("http://localhost/api/voice/capabilities", {
            headers: { origin, cookie: "member" },
          }),
        )
      ).text(),
    );
  test("phone is on only when the provider, key, address and application are all set", async () => {
    expect((await read(voiceApp({}))).phone).toBe("off");
    expect((await read(voiceApp({ ...good, phoneRequestMode: "off" }))).phone).toBe("on");
    expect((await read(voiceApp({ ...good }, null))).phone).toBe("off");
    for (const missing of ["phonePublicKey", "phonePublicUrl", "phoneApplicationId"] as const)
      expect((await read(voiceApp({ ...good, [missing]: "" }))).phone).toBe("off");
    expect((await read(voiceApp({ ...good, phoneProvider: "off" }))).phone).toBe("off");
  });
});
