// The Twilio part of the "Phone numbers" settings, through the real routes: Twilio next to Telnyx, the default provider, what the answer
// holds (never the Auth Token's connection), the Test button for each provider, and the Auth Token's key route.
import { afterAll, describe, expect, test } from "bun:test";
import { normalizeCountries, phoneSettingsIssue } from "@zetta/core/phone";
import { Elysia } from "elysia";
import { createApp } from "../../app";
import { createConnectionRoutes } from "../connections/routes";
import { createIdentityAccess } from "../identity/access";
import { createPhoneProviderReader } from "../phone/config";
import { startFakeTelnyx } from "../phone/fake";
import { startFakeTwilio } from "../phone/fake-twilio";
import { createTelnyxProvider } from "../phone/telnyx";
import { createTwilioProvider } from "../phone/twilio";
import { fakeInstallationKeys, fakeInstallationSettings } from "./testing";
import { InvalidInstallationError, type InstallationSettings } from "./service";

const origin = "https://app.example.invalid";
const TELNYX_KEY_ID = "11111111-1111-7111-8111-111111111111";
const TWILIO_KEY_ID = "22222222-2222-7222-8222-222222222222";
const telnyx = startFakeTelnyx();
const twilio = startFakeTwilio();
afterAll(() => {
  telnyx.stop();
  twilio.stop();
});

const twilioOn = {
  phoneTwilio: "on",
  phoneTwilioAccountSid: twilio.accountSid,
  phonePublicUrl: "https://zetta.example.invalid",
  phoneRequestMode: "owner_request",
  phoneCountries: "br, us",
} as const;
const telnyxOn = {
  phoneProvider: "telnyx",
  phonePublicKey: telnyx.publicKey,
  phoneApplicationId: telnyx.connectionRef,
} as const;

function app(o: { twilioKey?: string | null; token?: string } = {}) {
  let saved: InstallationSettings = fakeInstallationSettings({
    phoneConnectionId: TELNYX_KEY_ID,
    phoneTwilioConnectionId: o.twilioKey === null ? null : TWILIO_KEY_ID,
  });
  const keys = fakeInstallationKeys({ keys: { [TELNYX_KEY_ID]: telnyx.apiKey } });
  const twilioKeys = fakeInstallationKeys({
    keys: { [TWILIO_KEY_ID]: o.token ?? twilio.authToken },
  });
  const reader = createPhoneProviderReader({
    load: async () => saved,
    key: keys,
    twilioKey: twilioKeys,
    create: (s, apiKey) =>
      createTelnyxProvider({
        apiKey,
        publicKey: s.phonePublicKey,
        connectionRef: s.phoneApplicationId,
        baseUrl: telnyx.baseUrl,
      }),
    createTwilio: (s, authToken) =>
      createTwilioProvider({
        accountSid: s.phoneTwilioAccountSid,
        authToken,
        publicUrl: s.phonePublicUrl,
        baseUrl: twilio.baseUrl,
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
  const a = createApp({
    auth: auth as never,
    installation: {
      access,
      installation: installation as never,
      runningMode: "local",
      phone: {
        reader,
        key: keys,
        twilioKey: twilioKeys,
        address: async (raw) =>
          raw.startsWith("https://")
            ? { ok: true, message: "The public address answers." }
            : { ok: false, message: "The public address must be an https address." },
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
  return { call, reader, access, current: () => saved };
}
const patch = (t: ReturnType<typeof app>, body: unknown) =>
  t.call("admin", "PATCH", "/api/installation", body);
const test_ = (t: ReturnType<typeof app>, body?: unknown) =>
  t.call("admin", "POST", "/api/installation/phone/test", body);

describe("reading", () => {
  test("members read the Twilio choice and whether a token is there, never its connection", async () => {
    const t = app();
    const r = await t.call("member", "GET", "/api/installation");
    const body = JSON.parse(r.text);
    expect(body).toMatchObject({
      phoneTwilio: "off",
      phoneTwilioAccountSid: "",
      phoneDefaultProvider: "telnyx",
      phoneTwilioKey: "set",
      phoneKey: "set",
    });
    expect(r.text).not.toContain(TWILIO_KEY_ID);
    expect(r.text).not.toContain(twilio.authToken);
    expect(Object.keys(body).filter((k) => /connectionid/i.test(k))).toEqual([]);
  });
  test("no token reads as none", async () => {
    const t = app({ twilioKey: null });
    expect(
      JSON.parse((await t.call("member", "GET", "/api/installation")).text).phoneTwilioKey,
    ).toBe("none");
  });
});

describe("saving", () => {
  test("an administrator switches Twilio on with its Account SID and public address", async () => {
    const t = app();
    const r = await patch(t, twilioOn);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({
      phoneTwilio: "on",
      phoneTwilioAccountSid: twilio.accountSid,
      phonePublicUrl: "https://zetta.example.invalid",
      phoneCountries: "BR,US",
      // Telnyx is untouched.
      phoneProvider: "off",
    });
    expect(r.text).not.toContain(TWILIO_KEY_ID);
  });
  test("both providers can be saved, with a default", async () => {
    const t = app();
    expect(
      (await patch(t, { ...twilioOn, ...telnyxOn, phoneDefaultProvider: "twilio" })).status,
    ).toBe(200);
    expect(t.current()).toMatchObject({
      phoneProvider: "telnyx",
      phoneTwilio: "on",
      phoneDefaultProvider: "twilio",
    });
    expect((await t.reader.offer()).providers?.map((p) => p.id)).toEqual(["telnyx", "twilio"]);
    expect((await t.reader.offer()).defaultProvider).toBe("twilio");
  });
  test("an Account SID that is not one, a switch that is not on or off, a default that is not a provider are refused", async () => {
    const t = app();
    for (const bad of [
      { phoneTwilioAccountSid: "AC123" },
      { phoneTwilioAccountSid: `SK${"0".repeat(32)}` },
      { phoneTwilio: "maybe" },
      { phoneDefaultProvider: "vonage" },
      { phoneTwilioConnectionId: "x" },
      { phoneTwilioAuthToken: "test-token" },
    ])
      expect((await patch(t, bad)).status).toBe(400);
    expect(t.current().phoneTwilio).toBe("off");
  });
  test("twilio needs its Account SID and public address before it is switched on", async () => {
    const t = app();
    expect((await patch(t, { phoneTwilio: "on" })).status).toBe(400);
    expect(
      (await patch(t, { phoneTwilio: "on", phoneTwilioAccountSid: twilio.accountSid })).status,
    ).toBe(400);
    expect(
      (
        await patch(t, {
          phoneTwilio: "on",
          phoneTwilioAccountSid: twilio.accountSid,
          phonePublicUrl: "http://zetta.example.invalid",
        })
      ).status,
    ).toBe(400);
    expect(t.current().phoneTwilio).toBe("off");
  });
  test("a member cannot", async () => {
    const t = app();
    expect((await t.call("member", "PATCH", "/api/installation", twilioOn)).status).toBe(403);
    expect(t.current().phoneTwilio).toBe("off");
  });
});

describe("the Test button", () => {
  test("administrators only", async () => {
    const t = app();
    await patch(t, twilioOn);
    expect(
      (await t.call("member", "POST", "/api/installation/phone/test", { provider: "twilio" }))
        .status,
    ).toBe(403);
  });
  test("twilio off asks to switch it on; no token asks for the token", async () => {
    const t = app();
    const off = JSON.parse((await test_(t, { provider: "twilio" })).text);
    expect(off).toMatchObject({ ok: false, message: "Switch Twilio on and save first." });
    const none = app({ twilioKey: null });
    await patch(none, twilioOn);
    expect(JSON.parse((await test_(none, { provider: "twilio" })).text).message).toContain(
      "Auth Token",
    );
  });
  test("a working token, the numbers resource and the address say so, with the balance", async () => {
    const t = app();
    await patch(t, twilioOn);
    const body = JSON.parse((await test_(t, { provider: "twilio" })).text);
    expect(body).toMatchObject({
      ok: true,
      provider: "twilio",
      keyOk: true,
      applicationOk: true,
      balance: "10.0000 USD",
    });
    // With only Twilio switched on, no body means Twilio.
    expect(JSON.parse((await test_(t)).text)).toMatchObject({ ok: true, provider: "twilio" });
  });
  test("a wrong token is named, and the sentence is fixed", async () => {
    const t = app({ token: "wrong-token" });
    await patch(t, twilioOn);
    const body = JSON.parse((await test_(t, { provider: "twilio" })).text);
    expect(body).toMatchObject({ ok: false, keyOk: false });
    expect(body.message).toContain("Account SID and Auth Token");
    expect(JSON.stringify(body)).not.toContain("wrong-token");
  });
  test("an address that fails is named, and a provider that is down gives a fixed sentence", async () => {
    const t = app();
    await patch(t, twilioOn);
    twilio.failNext(503);
    const down = JSON.parse((await test_(t, { provider: "twilio" })).text);
    expect(down.ok).toBe(false);
    expect(down.message).toContain("Try again");
  });
  test("each provider is tested on its own when both are set up", async () => {
    const t = app();
    await patch(t, { ...twilioOn, ...telnyxOn });
    expect(JSON.parse((await test_(t, { provider: "telnyx" })).text)).toMatchObject({
      ok: true,
      provider: "telnyx",
      balance: "10.00 USD",
    });
    expect(JSON.parse((await test_(t, { provider: "twilio" })).text)).toMatchObject({
      ok: true,
      provider: "twilio",
    });
    // No body, both on: Telnyx, as before.
    expect(JSON.parse((await test_(t)).text)).toMatchObject({ provider: "telnyx" });
  });
  test("a provider that is not one is refused", async () => {
    const t = app();
    expect((await test_(t, { provider: "vonage" })).status).toBe(400);
    expect((await test_(t, { extra: 1 })).status).toBe(400);
  });
});

describe("the Auth Token's key route", () => {
  const sealedSecret = "test-token-sealed-0000";
  const recorded: (string | null)[] = [];
  const created: { provider: string; label: string; secret: string }[] = [];
  const t = app();
  const connections = {
    configured: () => true,
    list: async () => [],
    create: async (_a: unknown, v: { provider: string; label: string; secret: string }) => {
      created.push(v);
      return {
        id: "c0000000-0000-7000-8000-000000000002",
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
  const telnyxRecorded: (string | null)[] = [];
  const routes = () =>
    new Elysia().use(
      createConnectionRoutes(
        {
          access: t.access,
          connections,
          phoneKey: { set: async (id) => void telnyxRecorded.push(id) },
          phoneTwilioKey: { set: async (id) => void recorded.push(id) },
        },
        [origin],
        keyring,
      ),
    );
  const call = (as: string, method: string, body?: unknown) =>
    routes().handle(
      new Request("http://localhost/api/connections/phone-twilio-key", {
        method,
        headers: { origin, cookie: as, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  test("an administrator seals the token for its own purpose; it goes to its own connection; the answer never carries it", async () => {
    const r = await call("admin", "PUT", { sealed: { secret: sealedSecret } });
    expect(r.status).toBe(200);
    expect(opened).toEqual([{ userId: "admin", purpose: "installation.phone-twilio-key" }]);
    expect(created).toEqual([
      { provider: "phonetwilio", label: "Phone numbers (Twilio)", secret: sealedSecret },
    ]);
    expect(recorded).toEqual(["c0000000-0000-7000-8000-000000000002"]);
    expect(telnyxRecorded).toEqual([]);
    const text = await r.text();
    expect(text).not.toContain(sealedSecret);
    expect(JSON.parse(text)).toEqual({ ok: true });
  });
  test("a member cannot save or remove it, and removing clears the record", async () => {
    expect((await call("member", "PUT", { sealed: { secret: sealedSecret } })).status).toBe(403);
    expect((await call("member", "DELETE")).status).toBe(403);
    expect(created.length).toBe(1);
    expect((await call("admin", "DELETE")).status).toBe(200);
    expect(recorded.at(-1)).toBeNull();
    expect(telnyxRecorded).toEqual([]);
  });
  test("a token too short, or a body with anything else, is refused", async () => {
    expect((await call("admin", "PUT", { sealed: { secret: "short" } })).status).toBe(400);
    expect((await call("admin", "PUT", { sealed: { secret: sealedSecret }, x: 1 })).status).toBe(
      400,
    );
  });
  test("the connection is a managed one: it is not listed or created through the general route", async () => {
    const generic = await routes().handle(
      new Request("http://localhost/api/connections", {
        method: "POST",
        headers: { origin, cookie: "admin", "content-type": "application/json" },
        body: JSON.stringify({ provider: "phonetwilio", label: "x", secret: "test-token-0000" }),
      }),
    );
    expect(generic.status).toBeGreaterThanOrEqual(400);
    expect(created.length).toBe(1);
  });
});
