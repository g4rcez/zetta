// The Twilio adapter against the fake Twilio server and its webhook signer (no network, no account). Numbers are fictional.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createPhoneProviderReader } from "./config";
import { parseStreamTwiml, signLikeTwilio, startFakeTwilio } from "./fake-twilio";
import { PhoneProviderError, WebhookError, type PhoneProvider } from "./provider";
import {
  TWILIO_STATUS_PATH,
  TWILIO_VOICE_PATH,
  createTwilioProvider,
  rejectTwiml,
  streamTwiml,
  twilioSignature,
  xmlEscape,
} from "./twilio";

const fake = startFakeTwilio();
afterAll(() => fake.stop());
const SID = (n: number) => `CA${String(n).padStart(32, "0")}`;
const make = (o: { authToken?: string; accountSid?: string; replyTimeoutMs?: number } = {}) =>
  createTwilioProvider({
    accountSid: o.accountSid ?? fake.accountSid,
    authToken: o.authToken ?? fake.authToken,
    publicUrl: fake.publicUrl,
    baseUrl: fake.baseUrl,
    replyTimeoutMs: o.replyTimeoutMs,
  });
beforeEach(() => {
  fake.calls.length = 0;
  fake.held.clear();
  fake.voiceUrls.clear();
  fake.bundleCountries.clear();
  fake.placed.length = 0;
  fake.updates.length = 0;
});
const thrown = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e;
  }
  return undefined;
};
const verify = (
  p: PhoneProvider,
  w: { body: string; headers: Record<string, string>; path: string },
) => p.verifyWebhook(w.body, new Headers(w.headers), { path: w.path });

describe("the signature", () => {
  const url = `${fake.publicUrl}${TWILIO_VOICE_PATH}`;
  const params = {
    AccountSid: `AC${"0".repeat(32)}`,
    CallSid: SID(1),
    CallStatus: "ringing",
    Direction: "inbound",
    From: "+14155550100",
    To: "+14155550101",
  };
  test("matches a value made by openssl (HMAC-SHA1, base64) over the address and the sorted parameters", () => {
    // printf '<url>AccountSid...To+14155550101' | openssl dgst -sha1 -hmac test-token -binary | openssl base64
    expect(twilioSignature("test-token", url, params)).toBe("rLfY9HJGm7KKnEkC0BtxpML3veQ=");
    expect(signLikeTwilio("test-token", url, params)).toBe("rLfY9HJGm7KKnEkC0BtxpML3veQ=");
  });
  test("does not depend on the order the parameters arrive in", () => {
    const shuffled = new URLSearchParams(Object.entries(params).reverse());
    expect(twilioSignature("test-token", url, shuffled)).toBe("rLfY9HJGm7KKnEkC0BtxpML3veQ=");
  });
  test("a changed value, address or token changes it", () => {
    const good = twilioSignature("test-token", url, params);
    expect(twilioSignature("test-token", url, { ...params, To: "+14155550199" })).not.toBe(good);
    expect(twilioSignature("test-token", `${url}x`, params)).not.toBe(good);
    expect(twilioSignature("other-token", url, params)).not.toBe(good);
  });
});

describe("webhooks", () => {
  test("a good voice webhook becomes an incoming call.initiated event", () => {
    const p = make();
    const ev = verify(p, fake.voice(SID(2), "+14155550100", "+14155550101"));
    expect(ev).toMatchObject({
      id: `tw:${SID(2)}:voice`,
      type: "call.initiated",
      direction: "incoming",
      callControlId: SID(2),
      from: "+14155550100",
      to: "+14155550101",
    });
  });
  test("a tampered body, a wrong token, a wrong address and a missing signature are refused", () => {
    const p = make();
    const w = fake.voice(SID(3), "+14155550100", "+14155550101");
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof WebhookError ? e.code : "other";
      }
      return "passed";
    };
    expect(code(() => verify(p, { ...w, body: w.body.replace("5550100", "5550199") }))).toBe(
      "BAD_SIGNATURE",
    );
    expect(
      code(() =>
        verify(
          p,
          fake.webhook(
            w.path,
            { CallSid: SID(3), AccountSid: fake.accountSid, Direction: "inbound" },
            { token: "wrong" },
          ),
        ),
      ),
    ).toBe("BAD_SIGNATURE");
    expect(
      code(() =>
        verify(
          p,
          fake.webhook(
            w.path,
            { CallSid: SID(3), AccountSid: fake.accountSid, Direction: "inbound" },
            { url: "https://evil.example.invalid/api/phone/twilio/voice" },
          ),
        ),
      ),
    ).toBe("BAD_SIGNATURE");
    expect(code(() => p.verifyWebhook(w.body, new Headers(), { path: w.path }))).toBe("MALFORMED");
    expect(code(() => p.verifyWebhook(w.body, new Headers(w.headers), {}))).toBe("MALFORMED");
    expect(code(() => p.verifyWebhook(w.body, new Headers(w.headers), { path: "/api/x" }))).toBe(
      "MALFORMED",
    );
  });
  test("a request that names another host is refused even with a good signature", () => {
    const p = make();
    const w = fake.voice(SID(4), "+14155550100", "+14155550101");
    const err = thrown(() =>
      verify(p, { ...w, headers: { ...w.headers, host: "evil.example.invalid" } }),
    );
    return expect(err).resolves.toMatchObject({ code: "BAD_HOST" });
  });
  test("the port 443 and a forwarded host naming the public address are fine", () => {
    const p = make();
    const w = fake.voice(SID(5), "+14155550100", "+14155550101");
    expect(
      verify(p, { ...w, headers: { ...w.headers, host: "zetta.example.invalid:443" } }).type,
    ).toBe("call.initiated");
    expect(
      verify(p, {
        ...w,
        headers: {
          ...w.headers,
          host: "10.0.0.1:3000",
          "x-forwarded-host": "zetta.example.invalid",
        },
      }).type,
    ).toBe("call.initiated");
  });
  test("a webhook of another account is refused", async () => {
    const p = make();
    const w = fake.webhook(TWILIO_VOICE_PATH, {
      CallSid: SID(6),
      AccountSid: `AC${"1".repeat(32)}`,
      Direction: "inbound",
    });
    expect(await thrown(() => verify(p, w))).toMatchObject({ code: "BAD_ACCOUNT" });
  });
  test("a call sid that is not one is refused", async () => {
    const p = make();
    const w = fake.webhook(TWILIO_STATUS_PATH, {
      CallSid: "nope",
      AccountSid: fake.accountSid,
      CallStatus: "completed",
    });
    expect(await thrown(() => verify(p, w))).toMatchObject({ code: "MALFORMED" });
  });
  test("status callbacks map to the events the call understands, with ids that tell repeats apart", () => {
    const p = make();
    expect(verify(p, fake.status(SID(7), "in-progress", 1))).toMatchObject({
      type: "call.answered",
      id: `tw:${SID(7)}:in-progress:1`,
    });
    expect(verify(p, fake.status(SID(7), "completed", 2)).type).toBe("call.hangup");
    for (const s of ["busy", "failed", "no-answer", "canceled"])
      expect(verify(p, fake.status(SID(7), s, 3)).type).toBe("call.hangup");
    expect(verify(p, fake.status(SID(7), "ringing", 0)).type).toBe("call.status");
    // The same call and status with another sequence number is another event; the same sequence is the same event.
    expect(verify(p, fake.status(SID(7), "completed", 2)).id).toBe(
      verify(p, fake.status(SID(7), "completed", 2)).id,
    );
    expect(verify(p, fake.status(SID(7), "completed", 4)).id).not.toBe(
      verify(p, fake.status(SID(7), "completed", 2)).id,
    );
  });
  test("an answering machine result becomes a detection event", () => {
    const p = make();
    expect(verify(p, fake.machine(SID(8), "human")).payload.result).toBe("human");
    expect(verify(p, fake.machine(SID(8), "machine_start")).payload.result).toBe("machine");
    expect(verify(p, fake.machine(SID(8), "machine_end_beep")).payload.result).toBe("machine");
    expect(verify(p, fake.machine(SID(8), "fax")).payload.result).toBe("machine");
    expect(verify(p, fake.machine(SID(8), "unknown")).payload.result).toBe("human");
    expect(verify(p, fake.machine(SID(8), "human")).type).toBe("call.machine.detection.ended");
  });
});

describe("the answer to a ringing call", () => {
  const target = {
    streamUrl: "wss://zetta.example.invalid/api/phone/stream",
    streamParams: { token: "one-time" },
  };
  test("answer fills the reply, which the route reads after the event was handled", async () => {
    const p = make();
    const ev = verify(p, fake.voice(SID(9), "+14155550100", "+14155550101"));
    await p.answer(SID(9), { ...target, codec: "PCMU" });
    const xml = await p.reply!(ev);
    expect(parseStreamTwiml(xml!)).toEqual({
      url: target.streamUrl,
      params: { token: "one-time" },
    });
    expect(xml).toContain("<Connect>");
    expect(xml).toContain("<Hangup/>");
    expect(fake.calls).toEqual([]); // nothing was sent to the REST API: the answer is the HTTP response
  });
  test("reject fills it with a busy rejection", async () => {
    const p = make();
    const ev = verify(p, fake.voice(SID(10), "+14155550100", "+14155550101"));
    await p.reject(SID(10));
    expect(await p.reply!(ev)).toBe(rejectTwiml());
    expect(rejectTwiml()).toContain('<Reject reason="busy"/>');
  });
  test("with no answer in time the call is refused", async () => {
    const p = make({ replyTimeoutMs: 30 });
    const ev = verify(p, fake.voice(SID(11), "+14155550100", "+14155550101"));
    expect(await p.reply!(ev)).toBe(rejectTwiml());
  });
  test("a call that is no longer waiting is changed through the REST API", async () => {
    const p = make();
    await p.answer(SID(12), { ...target, codec: "PCMU" });
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]!.sid).toBe(SID(12));
    expect(parseStreamTwiml(fake.updates[0]!.form.Twiml![0]!).params.token).toBe("one-time");
    await p.reject(SID(13));
    expect(fake.updates[1]!.form.Status).toEqual(["completed"]);
  });
  test("hangup completes the call, and a call that is gone is not an error", async () => {
    const p = make();
    await p.hangup(SID(14));
    expect(fake.updates.at(-1)!.form.Status).toEqual(["completed"]);
  });
  test("a status event has nothing to send back", async () => {
    const p = make();
    const ev = verify(p, fake.status(SID(15), "completed", 1));
    expect(await p.reply!(ev)).toBeUndefined();
  });
  test("a voice webhook for a call we did not place is refused when nothing waits for it", async () => {
    const p = make();
    const ev = verify(p, fake.voice(SID(16), "+14155550100", "+14155550101"));
    await p.reject(SID(16));
    await p.reply!(ev); // consumes the pending answer
    expect(await p.reply!(ev)).toBe(rejectTwiml());
  });
});

describe("TwiML", () => {
  test("every interpolated value is escaped", () => {
    const xml = streamTwiml("wss://zetta.example.invalid/api/phone/stream", {
      'to"ken': `a&b<c>"d'e`,
    });
    expect(xml).toContain('name="to&quot;ken"');
    expect(xml).toContain('value="a&amp;b&lt;c&gt;&quot;d&apos;e"');
    expect(xml).not.toContain('"to"ken"');
    expect(parseStreamTwiml(xml).params).toEqual({ 'to"ken': `a&b<c>"d'e` });
    expect(xmlEscape(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });
  test("a stream address with a query, or without wss, is refused", () => {
    expect(() => streamTwiml("wss://zetta.example.invalid/api/phone/stream?token=x")).toThrow();
    expect(() => streamTwiml("https://zetta.example.invalid/x")).toThrow();
    // A quote in the address cannot break out of the attribute: it is escaped.
    const sneaky = streamTwiml('wss://zetta.example.invalid/"><Hangup/>');
    expect(sneaky).toContain("&quot;&gt;&lt;Hangup/&gt;");
    expect(sneaky.match(/<Hangup\/>/g)).toHaveLength(1);
  });
  test("a parameter whose name and value are 500 characters or more is left out (Twilio's limit)", () => {
    expect(streamTwiml("wss://a.example.invalid/s", { t: "x".repeat(600) })).not.toContain(
      "<Parameter",
    );
  });
});

describe("numbers", () => {
  test("search asks for local voice numbers of a country and area, and reads the answer", async () => {
    const found = await make().searchNumbers({ country: "US", areaCode: "415", limit: 2 });
    expect(found).toEqual([{ e164: "+14155550100", country: "US", requirements: "none" }]);
    const call = fake.calls.at(-1)!;
    expect(call.method).toBe("GET");
    expect(
      call.path.startsWith(`/Accounts/${fake.accountSid}/AvailablePhoneNumbers/US/Local.json?`),
    ).toBe(true);
    const q = new URL(`http://x${call.path}`).searchParams;
    expect(q.get("VoiceEnabled")).toBe("true");
    expect(q.get("AreaCode")).toBe("415");
    expect(q.get("PageSize")).toBe("2");
    expect(call.auth).toBe(
      `Basic ${Buffer.from(`${fake.accountSid}:${fake.authToken}`).toString("base64")}`,
    );
  });
  test("an order buys the number with the voice and status addresses", async () => {
    const p = make();
    const [n] = await p.searchNumbers({ country: "US" });
    const order = await p.orderNumber({
      e164: n!.e164,
      reference: "bot-1",
      requirements: n!.requirements,
    });
    expect(order).toMatchObject({ e164: n!.e164, status: "active" });
    expect(order.providerRef).toMatch(/^PN/);
    const sent = fake.calls.find((c) => c.method === "POST")!;
    expect(sent.path).toBe(`/Accounts/${fake.accountSid}/IncomingPhoneNumbers.json`);
    expect(sent.form.PhoneNumber).toEqual([n!.e164]);
    expect(sent.form.VoiceUrl).toEqual([`${fake.publicUrl}${TWILIO_VOICE_PATH}`]);
    expect(sent.form.StatusCallback).toEqual([`${fake.publicUrl}${TWILIO_STATUS_PATH}`]);
    expect(sent.form.FriendlyName).toEqual(["Zetta bot-1"]);
    expect(fake.held.has(n!.e164)).toBe(true);
  });
  test("a country that needs a regulatory bundle is not bought: the sentence says to buy in the console and attach", async () => {
    fake.bundleCountries.add("BR");
    const p = make();
    const [n] = await p.searchNumbers({ country: "BR" });
    expect(n!.requirements).toBe("any");
    const err = (await thrown(
      p.orderNumber({ e164: n!.e164, reference: "bot-1", requirements: n!.requirements }),
    )) as PhoneProviderError;
    expect(err).toBeInstanceOf(PhoneProviderError);
    expect(err.code).toBe("REFUSED");
    expect(err.safe).toMatch(
      /Buy the number in the Twilio console with your company's bundle, then attach it here/,
    );
    expect(fake.calls.some((c) => c.method === "POST")).toBe(false);
    expect(fake.held.size).toBe(0);
  });
  test("find reads a held number's sid and voice address; a number it does not hold is null", async () => {
    const p = make();
    expect(await p.findNumber("+14155550142")).toBeNull();
    fake.held.set("+14155550142", "PN00000000000000000000000000000042");
    expect(await p.findNumber("+14155550142")).toEqual({
      providerRef: "PN00000000000000000000000000000042",
      connectionRef: null,
      status: "active",
    });
  });
  test("route points a number the account holds at the voice address, once", async () => {
    const p = make();
    fake.held.set("+14155550143", "PN00000000000000000000000000000043");
    await p.routeNumber("+14155550143");
    expect(fake.voiceUrls.get("PN00000000000000000000000000000043")).toBe(
      `${fake.publicUrl}${TWILIO_VOICE_PATH}`,
    );
    const before = fake.calls.length;
    await p.routeNumber("+14155550143");
    expect(fake.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
    expect(await thrown(p.routeNumber("+14155550199"))).toMatchObject({ code: "NOT_FOUND" });
  });
  test("release deletes the number, and a number the account no longer holds is not an error", async () => {
    const p = make();
    fake.held.set("+14155550144", "PN00000000000000000000000000000044");
    await p.releaseNumber("+14155550144");
    expect(fake.held.has("+14155550144")).toBe(false);
    await p.releaseNumber("+14155550144");
  });
  test("order status is active for a number that exists, failed for one that does not", async () => {
    const p = make();
    fake.held.set("+14155550145", "PN00000000000000000000000000000045");
    expect(await p.orderStatus("PN00000000000000000000000000000045")).toBe("active");
    expect(await p.orderStatus("PN99999999999999999999999999999999")).toBe("failed");
  });
});

describe("calls", () => {
  test("placing a call sends inline TwiML with the stream and token, status events and answering machine detection", async () => {
    const p = make();
    const placed = await p.placeCall({
      to: "+14155550150",
      from: "+14155550151",
      streamUrl: "wss://zetta.example.invalid/api/phone/stream",
      streamParams: { token: "one-time" },
      codec: "PCMU",
      timeLimitSecs: 600,
      detectMachine: true,
    });
    expect(placed.callControlId).toMatch(/^CA/);
    const sent = fake.placed[0]!.form;
    expect(sent.To).toEqual(["+14155550150"]);
    expect(sent.From).toEqual(["+14155550151"]);
    expect(parseStreamTwiml(sent.Twiml![0]!).params).toEqual({ token: "one-time" });
    expect(sent.StatusCallback).toEqual([`${fake.publicUrl}${TWILIO_STATUS_PATH}`]);
    expect(sent.StatusCallbackEvent).toEqual(["answered", "completed"]);
    expect(sent.TimeLimit).toEqual(["600"]);
    expect(sent.MachineDetection).toEqual(["Enable"]);
    expect(sent.AsyncAmd).toEqual(["true"]);
    expect(sent.AsyncAmdStatusCallback).toEqual([`${fake.publicUrl}${TWILIO_STATUS_PATH}`]);
  });
  test("without machine detection nothing about it is sent, and the time limit is at least 30 seconds", async () => {
    await make().placeCall({
      to: "+14155550150",
      from: "+14155550151",
      streamUrl: "wss://zetta.example.invalid/api/phone/stream",
      timeLimitSecs: 5,
    });
    const sent = fake.placed[0]!.form;
    expect(sent.MachineDetection).toBeUndefined();
    expect(sent.TimeLimit).toEqual(["30"]);
  });
});

describe("the account check", () => {
  test("reads the balance and finds the numbers resource", async () => {
    expect(await make().checkAccount()).toEqual({
      keyOk: true,
      applicationOk: true,
      balance: "10.0000 USD",
    });
  });
  test("a wrong token says the key is not accepted", async () => {
    expect(await make({ authToken: "wrong" }).checkAccount()).toEqual({
      keyOk: false,
      applicationOk: false,
    });
  });
});

describe("errors", () => {
  test("every failure is a fixed sentence, never the provider's words", async () => {
    const p = make();
    for (const [status, code] of [
      [401, "AUTH"],
      [404, "NOT_FOUND"],
      [429, "UNAVAILABLE"],
      [503, "UNAVAILABLE"],
      [400, "REFUSED"],
    ] as const) {
      fake.failNext(status);
      const err = (await thrown(p.searchNumbers({ country: "US" }))) as PhoneProviderError;
      expect(err.code).toBe(code);
      expect(err.safe).not.toMatch(/failure|20500|message/);
    }
    // a network failure
    const down = createTwilioProvider({
      accountSid: fake.accountSid,
      authToken: fake.authToken,
      publicUrl: fake.publicUrl,
      baseUrl: "http://127.0.0.1:1/2010-04-01",
      timeoutMs: 500,
    });
    expect(await thrown(down.searchNumbers({ country: "US" }))).toMatchObject({
      code: "UNAVAILABLE",
    });
  });
  test("the Auth Token is sent only as the basic-auth password, never in an address or body", async () => {
    const p = make();
    await p.searchNumbers({ country: "US" });
    await p.placeCall({
      to: "+14155550150",
      from: "+14155550151",
      streamUrl: "wss://zetta.example.invalid/api/phone/stream",
    });
    for (const c of fake.calls) {
      expect(c.path).not.toContain(fake.authToken);
      expect(JSON.stringify(c.form)).not.toContain(fake.authToken);
    }
  });
  test("a redirect is an error, not followed", async () => {
    const redirecting = createTwilioProvider({
      accountSid: fake.accountSid,
      authToken: fake.authToken,
      publicUrl: fake.publicUrl,
      baseUrl: fake.baseUrl,
      fetch: (async () => {
        throw new TypeError("redirect");
      }) as never,
    });
    expect(await thrown(redirecting.searchNumbers({ country: "US" }))).toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});

describe("the reader", () => {
  const settings = {
    phoneProvider: "off",
    phonePublicKey: "",
    phonePublicUrl: fake.publicUrl,
    phoneApplicationId: "",
    phoneRequestMode: "owner_request",
    phoneCountries: "US",
    phoneMaxNumbers: 5,
    phoneMaxCallMinutes: 30,
    phoneDailyMinutesPerBot: 60,
    phoneDailyCallsPerBot: 20,
    phoneTwilio: "on",
    phoneTwilioAccountSid: fake.accountSid,
    phoneDefaultProvider: "twilio",
    phoneConnectionId: null,
    phoneTwilioConnectionId: "conn-twilio",
  };
  test("the Auth Token buffer is zeroed after the provider was built, and the provider still works", async () => {
    const secret = Buffer.from(fake.authToken);
    const reader = createPhoneProviderReader({
      load: async () => settings as never,
      key: { state: async () => "none", secret: async () => undefined },
      twilioKey: { state: async () => "set", secret: async () => secret },
      createTwilio: (s, token) =>
        createTwilioProvider({
          accountSid: s.phoneTwilioAccountSid,
          authToken: token,
          publicUrl: s.phonePublicUrl,
          baseUrl: fake.baseUrl,
        }),
    });
    const provider = await reader.provider("twilio");
    expect([...secret].every((b) => b === 0)).toBe(true);
    expect((await provider!.checkAccount()).keyOk).toBe(true);
    expect(await reader.provider("telnyx")).toBeUndefined();
    expect((await reader.offer()).providers).toEqual([{ id: "twilio", countries: ["US"] }]);
    expect((await reader.offer()).defaultProvider).toBe("twilio");
  });
  test("with no key, or Twilio switched off, there is no provider", async () => {
    const make = (over: Record<string, unknown>, state: string, has: boolean) =>
      createPhoneProviderReader({
        load: async () => ({ ...settings, ...over }) as never,
        key: { state: async () => "none", secret: async () => undefined },
        twilioKey: {
          state: async () => state as never,
          secret: async () => (has ? Buffer.from("test-token") : undefined),
        },
      });
    expect(await make({}, "none", false).provider("twilio")).toBeUndefined();
    expect(await make({ phoneTwilio: "off" }, "set", true).provider("twilio")).toBeUndefined();
    expect((await make({}, "none", false).offer()).on).toBe(false);
    expect((await make({ phoneTwilio: "off" }, "set", true).offer()).providers).toEqual([]);
  });
});
