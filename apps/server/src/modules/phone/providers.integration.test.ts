// Two phone providers set up at once, against Postgres, the fake Telnyx and the fake Twilio (run with ZETTA_TEST_DB=embedded; without it
// this suite skips, which looks like a pass: the run says how many tests were skipped). The real provider reader chooses the adapter of
// each number from what the installation settings and the keys say. No real Telnyx or Twilio account was used.
import type { PhoneAllSettings, PhoneProviderId } from "@zetta/core/phone";
import { DEFAULT_PHONE_TWILIO_SETTINGS } from "@zetta/core/phone";
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { phoneNumber } from "@zetta/db/schema/phone";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createMembershipLookup, issueBackgroundActor, type ActiveActor } from "../identity/access";
import type { InstallationSettings } from "../installation/service";
import { fakeInstallationSettings } from "../installation/testing";
import { createPhoneProviderReader } from "./config";
import { startFakeTelnyx } from "./fake";
import { startFakeTwilio } from "./fake-twilio";
import { PhoneError, createPhoneService } from "./service";
import { createTelnyxProvider } from "./telnyx";
import { createTwilioProvider } from "./twilio";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `ph-pa-${uuidv7()}`;
const ADMIN = `ph-padmin-${uuidv7()}`;
const ids = [A, ADMIN];

suite("two phone providers at once against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  const telnyx = startFakeTelnyx();
  const twilio = startFakeTwilio();
  let settings: InstallationSettings;
  let keys = { telnyx: "set", twilio: "set" };
  const reset = () => {
    settings = fakeInstallationSettings({
      phoneProvider: "telnyx",
      phonePublicKey: telnyx.publicKey,
      phonePublicUrl: twilio.publicUrl,
      phoneApplicationId: telnyx.connectionRef,
      phoneRequestMode: "owner_request",
      phoneCountries: "US,BR",
      phoneTwilio: "on",
      phoneTwilioAccountSid: twilio.accountSid,
      phoneDefaultProvider: "telnyx",
      phoneConnectionId: uuidv7(),
      phoneTwilioConnectionId: uuidv7(),
    });
    keys = { telnyx: "set", twilio: "set" };
  };
  const reader = createPhoneProviderReader({
    load: async () => settings,
    key: {
      state: async () => keys.telnyx as never,
      secret: async () => (keys.telnyx === "none" ? undefined : Buffer.from(telnyx.apiKey)),
    },
    twilioKey: {
      state: async () => keys.twilio as never,
      secret: async () => (keys.twilio === "none" ? undefined : Buffer.from(twilio.authToken)),
    },
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
  const trail: string[] = [];
  const service = createPhoneService({
    db,
    reader,
    audit: (e) => void trail.push(e.kind),
  });
  let a!: ActiveActor;
  let admin!: ActiveActor;
  const mkBot = async (name: string) => {
    const [row] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name,
        slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
        onboarded: true,
      })
      .returning();
    return row!;
  };
  const failsWith = async (q: Promise<unknown>, code: PhoneError["code"], text?: RegExp) => {
    const e = await q.then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(PhoneError);
    expect((e as PhoneError).code).toBe(code);
    if (text) expect((e as PhoneError).safe).toMatch(text);
  };
  const rowOf = async (id: string) =>
    (await db.select().from(phoneNumber).where(eq(phoneNumber.id, id)))[0]!;

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    a = (await issueBackgroundActor(lookup, A))!;
    admin = Object.freeze({ userId: ADMIN, isAdmin: true });
  });
  afterAll(async () => {
    await db.delete(phoneNumber);
    await cleanupTestUsers(db, ids);
    telnyx.stop();
    twilio.stop();
  });
  beforeEach(async () => {
    reset();
    trail.length = 0;
    telnyx.held.clear();
    telnyx.orders.clear();
    telnyx.calls.length = 0;
    twilio.held.clear();
    twilio.bundleCountries.clear();
    twilio.calls.length = 0;
    await db.delete(phoneNumber);
  });

  test("the offer lists both ready providers, the countries, and the default", async () => {
    expect(await service.offer()).toMatchObject({
      on: true,
      mode: "owner_request",
      countries: ["US", "BR"],
      providers: [
        { id: "telnyx", countries: ["US", "BR"] },
        { id: "twilio", countries: ["US", "BR"] },
      ],
      defaultProvider: "telnyx",
    });
    settings.phoneDefaultProvider = "twilio";
    expect((await service.offer()).defaultProvider).toBe("twilio");
    keys.telnyx = "none";
    expect(await service.offer()).toMatchObject({
      providers: [{ id: "twilio", countries: ["US", "BR"] }],
      defaultProvider: "twilio",
    });
    keys.twilio = "none";
    expect(await service.offer()).toMatchObject({ on: false, mode: "off", providers: [] });
  });

  test("a request without a provider uses the default; one that names a provider uses it", async () => {
    const one = await mkBot("One");
    const viaDefault = await service.request(a, one.id, { country: "US" });
    expect(viaDefault.provider).toBe("telnyx");
    expect(telnyx.orders.size).toBe(1);
    expect(twilio.held.size).toBe(0);
    expect((await rowOf(viaDefault.id)).provider).toBe("telnyx");

    const two = await mkBot("Two");
    const viaTwilio = await service.request(a, two.id, { country: "US", provider: "twilio" });
    expect(viaTwilio).toMatchObject({ provider: "twilio", status: "active" });
    expect(twilio.held.has(viaTwilio.number!)).toBe(true);
    expect(telnyx.orders.size).toBe(1);
    expect((await rowOf(viaTwilio.id)).provider).toBe("twilio");
    // What Twilio was asked: the buy carries the webhook addresses, and Telnyx saw nothing of this number.
    const bought = twilio.calls.find((c) => c.method === "POST")!;
    expect(bought.form.VoiceUrl![0]).toBe(`${twilio.publicUrl}/api/phone/twilio/voice`);
    expect(telnyx.calls.some((c) => JSON.stringify(c.body ?? "").includes(viaTwilio.number!))).toBe(
      false,
    );

    settings.phoneDefaultProvider = "twilio";
    const three = await mkBot("Three");
    expect((await service.request(a, three.id, { country: "US" })).provider).toBe("twilio");
  });

  test("when the default is not ready the only ready provider is used", async () => {
    keys.telnyx = "none";
    const one = await mkBot("OnlyTwilio");
    expect((await service.request(a, one.id, { country: "US" })).provider).toBe("twilio");
  });

  test("a provider that is named but not ready is refused with a sentence that names it", async () => {
    keys.twilio = "none";
    const one = await mkBot("NotReady");
    await failsWith(
      service.request(a, one.id, { country: "US", provider: "twilio" }),
      "NOT_OFFERED",
      /Twilio is not ready/,
    );
    settings.phoneTwilio = "on";
    keys = { telnyx: "none", twilio: "set" };
    await failsWith(
      service.request(a, one.id, { country: "US", provider: "telnyx" }),
      "NOT_OFFERED",
      /Telnyx is not ready/,
    );
    expect(await db.select().from(phoneNumber)).toHaveLength(0);
  });

  test("in approval mode the request keeps its provider and the approval buys at that provider", async () => {
    settings.phoneRequestMode = "operator_approval";
    const one = await mkBot("Approval");
    const req = await service.request(a, one.id, { country: "US", provider: "twilio" });
    expect(req).toMatchObject({ status: "requested", provider: "twilio", number: null });
    expect(twilio.held.size).toBe(0);
    const approved = await service.approve(admin, req.id);
    expect(approved).toMatchObject({ status: "active", provider: "twilio" });
    expect(twilio.held.size).toBe(1);
    expect(telnyx.orders.size).toBe(0);
  });

  test("Brazil at Twilio is not bought here: the sentence says to buy with the company's bundle and attach", async () => {
    twilio.bundleCountries.add("BR");
    const one = await mkBot("Brazil");
    await failsWith(
      service.request(a, one.id, { country: "BR", provider: "twilio" }),
      "PROVIDER",
      /Buy the number in the Twilio console with your company's bundle, then attach it here/,
    );
    expect(twilio.held.size).toBe(0);
    expect(await db.select().from(phoneNumber)).toHaveLength(0);
    // The same country at Telnyx goes on as before.
    expect((await service.request(a, one.id, { country: "BR", provider: "telnyx" })).provider).toBe(
      "telnyx",
    );
  });

  test("attach takes a provider: the number must be held by that provider's account", async () => {
    const OWN_US = "+12025550101";
    const OWN_BR = "+551155550101";
    twilio.held.set(OWN_US, "PN00000000000000000000000000000101");
    twilio.held.set(OWN_BR, "PN00000000000000000000000000000102");
    const one = await mkBot("Attach");
    // Not held at Telnyx: refused, and nothing recorded.
    await failsWith(
      service.attach(admin, { botId: one.id, number: OWN_US, provider: "telnyx" }),
      "NO_NUMBER",
    );
    const view = await service.attach(admin, { botId: one.id, number: OWN_US, provider: "twilio" });
    expect(view).toMatchObject({
      number: OWN_US,
      provider: "twilio",
      status: "active",
      country: "US",
    });
    expect(twilio.voiceUrls.get("PN00000000000000000000000000000101")).toBe(
      `${twilio.publicUrl}/api/phone/twilio/voice`,
    );
    expect((await rowOf(view.id)).providerRef).toBe("PN00000000000000000000000000000101");
    // A Brazilian number bought by hand in the console, with the company's bundle, is attached.
    const br = await mkBot("AttachBr");
    expect(
      await service.attach(admin, { botId: br.id, number: OWN_BR, provider: "twilio" }),
    ).toMatchObject({ provider: "twilio", country: "BR", status: "active" });
    // Without a provider the default one is asked: Telnyx does not hold it.
    const three = await mkBot("AttachDefault");
    await failsWith(
      service.attach(admin, { botId: three.id, number: "+12025550102" }),
      "NO_NUMBER",
    );
    expect(trail.filter((t) => t === "phone:attached")).toHaveLength(2);
  });

  test("each number is released, synced and listed through its own provider", async () => {
    const one = await mkBot("RelOne");
    const two = await mkBot("RelTwo");
    const t1 = await service.request(a, one.id, { country: "US", provider: "telnyx" });
    const t2 = await service.request(a, two.id, { country: "US", provider: "twilio" });
    const list = await service.list(admin);
    expect(list.map((v) => [v.botId, v.provider]).sort()).toEqual(
      [
        [one.id, "telnyx"],
        [two.id, "twilio"],
      ].sort(),
    );
    telnyx.calls.length = 0;
    twilio.calls.length = 0;
    await service.release(a, two.id);
    expect(twilio.held.has(t2.number!)).toBe(false);
    expect(telnyx.calls).toHaveLength(0);
    await service.release(a, one.id);
    expect(telnyx.held.has(t1.number!)).toBe(false);
    expect((await rowOf(t1.id)).status).toBe("released");
    expect((await rowOf(t2.id)).status).toBe("released");
  });

  test("a number whose provider is no longer set up cannot be released until it is", async () => {
    const one = await mkBot("Gone");
    const view = await service.request(a, one.id, { country: "US", provider: "twilio" });
    keys.twilio = "none";
    await failsWith(service.release(a, one.id), "NOT_OFFERED");
    expect((await rowOf(view.id)).status).toBe("active");
    keys.twilio = "set";
    await service.release(a, one.id);
    expect((await rowOf(view.id)).status).toBe("released");
  });

  test("defaults of the Twilio settings are off", () => {
    expect(DEFAULT_PHONE_TWILIO_SETTINGS).toEqual({
      phoneTwilio: "off",
      phoneTwilioAccountSid: "",
      phoneDefaultProvider: "telnyx",
    });
    const check: PhoneProviderId[] = ["telnyx", "twilio"];
    expect(check).toHaveLength(2);
    const s: Pick<PhoneAllSettings, "phoneTwilio"> = { phoneTwilio: "off" };
    expect(s.phoneTwilio).toBe("off");
  });
});
