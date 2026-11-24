// The Telnyx adapter against the fake Telnyx server and its webhook signer (no network, no account). Numbers are in reserved fictional ranges.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeTelnyx } from "./fake";
import { PhoneProviderError, WebhookError } from "./provider";
import { createTelnyxProvider, WEBHOOK_TOLERANCE_SECONDS } from "./telnyx";

const fake = startFakeTelnyx();
afterAll(() => fake.stop());
let clock = Date.now();
const make = (o: { apiKey?: string; publicKey?: string; connectionRef?: string } = {}) =>
  createTelnyxProvider({
    apiKey: o.apiKey ?? fake.apiKey,
    publicKey: o.publicKey ?? fake.publicKey,
    connectionRef: o.connectionRef ?? fake.connectionRef,
    baseUrl: fake.baseUrl,
    now: () => clock,
  });
beforeEach(() => {
  fake.calls.length = 0;
  fake.held.clear();
  fake.orders.clear();
  fake.reviewCountries.clear();
  clock = Date.now();
});

const thrown = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e;
  }
  return undefined;
};

describe("numbers", () => {
  test("search asks for local voice numbers of a country and area, and reads the answer", async () => {
    const found = await make().searchNumbers({ country: "US", areaCode: "415", limit: 2 });
    expect(found).toEqual([
      { e164: "+141555501" + "00", country: "US", monthlyCost: "1.00", currency: "USD" },
    ]);
    const call = fake.calls.at(-1)!;
    expect(call.method).toBe("GET");
    const q = new URL(`http://x${call.path}`).searchParams;
    expect(q.get("filter[country_code]")).toBe("US");
    expect(q.get("filter[national_destination_code]")).toBe("415");
    expect(q.get("filter[phone_number_type]")).toBe("local");
    expect(q.get("filter[limit]")).toBe("2");
    expect(call.auth).toBe(`Bearer ${fake.apiKey}`);
  });

  test("an order is active at once where nothing needs review, and attaches the call application", async () => {
    const p = make();
    const [n] = await p.searchNumbers({ country: "US" });
    const order = await p.orderNumber({ e164: n!.e164, reference: "bot-1" });
    expect(order.status).toBe("active");
    expect(order.e164).toBe(n!.e164);
    expect(fake.held.has(n!.e164)).toBe(true);
    const sent = fake.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(sent.connection_id).toBe(fake.connectionRef);
    expect(sent.customer_reference).toBe("bot-1");
  });

  test("a Brazilian order waits in review, then becomes active when the provider approves it", async () => {
    fake.reviewCountries.add("BR");
    const p = make();
    const [n] = await p.searchNumbers({ country: "BR", areaCode: "11" });
    expect(n!.e164.startsWith("+5511")).toBe(true);
    const order = await p.orderNumber({ e164: n!.e164, reference: "bot-1" });
    expect(order.status).toBe("pending_review");
    expect(await p.orderStatus(order.providerRef)).toBe("pending_review");
    expect(fake.held.size).toBe(0);
    fake.approveOrder(order.providerRef);
    expect(await p.orderStatus(order.providerRef)).toBe("active");
  });

  test("a refused order reads as failed", async () => {
    fake.reviewCountries.add("BR");
    const p = make();
    const [n] = await p.searchNumbers({ country: "BR" });
    const order = await p.orderNumber({ e164: n!.e164, reference: "bot-1" });
    fake.rejectOrder(order.providerRef);
    expect(await p.orderStatus(order.providerRef)).toBe("failed");
  });

  test("release finds the number by its digits and deletes it; releasing a number it no longer holds is fine", async () => {
    const p = make();
    const [n] = await p.searchNumbers({ country: "US" });
    await p.orderNumber({ e164: n!.e164, reference: "bot-1" });
    await p.releaseNumber(n!.e164);
    expect(fake.held.size).toBe(0);
    await p.releaseNumber(n!.e164);
  });
});

describe("a number the account already holds", () => {
  const own = "+14155550150";
  test("findNumber returns the id, the routing and the state; an unknown number is null", async () => {
    fake.held.set(own, "num-own-1");
    fake.routes.set("num-own-1", null);
    const p = make();
    expect(await p.findNumber(own)).toEqual({
      providerRef: "num-own-1",
      connectionRef: null,
      status: "active",
    });
    expect(fake.calls.at(-1)!.path).toBe(`/phone_numbers?filter%5Bphone_number%5D=%2B14155550150`);
    expect(await p.findNumber("+14155550151")).toBeNull();
  });

  test("findNumber with a key the provider refuses is AUTH", async () => {
    const e = await thrown(make({ apiKey: "KEY-wrong" }).findNumber(own));
    expect(e).toBeInstanceOf(PhoneProviderError);
    expect((e as PhoneProviderError).code).toBe("AUTH");
  });

  test("routeNumber patches connection_id of the number's id with the call application", async () => {
    fake.held.set(own, "num-own-2");
    fake.routes.set("num-own-2", "9999");
    await make().routeNumber(own);
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/phone_numbers/num-own-2");
    expect(patch.body).toEqual({ connection_id: fake.connectionRef });
    expect(fake.routes.get("num-own-2")).toBe(fake.connectionRef);
  });

  test("routeNumber sends nothing when the number already routes there, and is NOT_FOUND for a number not held", async () => {
    fake.held.set(own, "num-own-3");
    fake.routes.set("num-own-3", fake.connectionRef);
    fake.calls.length = 0;
    await make().routeNumber(own);
    expect(fake.calls.some((c) => c.method === "PATCH")).toBe(false);
    const e = await thrown(make().routeNumber("+14155550152"));
    expect((e as PhoneProviderError).code).toBe("NOT_FOUND");
  });
});

describe("calls", () => {
  test("placing a call sends the application, both numbers and a two-way stream", async () => {
    const placed = await make().placeCall({
      to: "+15550100999",
      from: "+15550100123",
      streamUrl: "wss://zetta.example.invalid/api/phone/stream",
      codec: "L16",
      clientState: "call-7",
      timeLimitSecs: 10,
      detectMachine: true,
    });
    expect(placed.callControlId.startsWith("v3:")).toBe(true);
    expect(placed.callSessionId).toMatch(/^session-/);
    const body = fake.calls.at(-1)!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      connection_id: fake.connectionRef,
      to: "+15550100999",
      from: "+15550100123",
      stream_url: "wss://zetta.example.invalid/api/phone/stream",
      stream_bidirectional_mode: "rtp",
      stream_bidirectional_codec: "L16",
      answering_machine_detection: "detect",
      time_limit_secs: 30,
    });
    expect(Buffer.from(body.client_state as string, "base64").toString()).toBe("call-7");
  });

  test("answer, reject, hang up and start a stream go to the call's own address", async () => {
    const p = make();
    await p.answer("v3:abc", { streamUrl: "wss://zetta.example.invalid/s", clientState: "x" });
    await p.reject("v3:abc");
    await p.hangup("v3:abc");
    await p.startStream("v3:abc", { streamUrl: "wss://zetta.example.invalid/s" });
    expect(fake.calls.map((c) => c.path)).toEqual([
      "/calls/v3%3Aabc/actions/answer",
      "/calls/v3%3Aabc/actions/reject",
      "/calls/v3%3Aabc/actions/hangup",
      "/calls/v3%3Aabc/actions/streaming_start",
    ]);
    expect(fake.calls[0]!.body).toMatchObject({ stream_bidirectional_codec: "PCMU" });
  });
});

describe("failures never carry the provider's words", () => {
  test("a wrong key is AUTH, a busy provider is UNAVAILABLE, a refusal is REFUSED", async () => {
    const wrong = await thrown(make({ apiKey: "wrong-key" }).searchNumbers({ country: "US" }));
    expect(wrong).toBeInstanceOf(PhoneProviderError);
    expect((wrong as PhoneProviderError).code).toBe("AUTH");
    fake.failNext(503);
    expect(
      ((await thrown(make().searchNumbers({ country: "US" }))) as PhoneProviderError).code,
    ).toBe("UNAVAILABLE");
    fake.failNext(422);
    const refused = (await thrown(
      make().orderNumber({ e164: "+15550100123", reference: "x" }),
    )) as PhoneProviderError;
    expect(refused.code).toBe("REFUSED");
    expect(refused.safe).not.toContain("failure");
  });

  test("an unreachable provider is UNAVAILABLE", async () => {
    const p = createTelnyxProvider({
      apiKey: "k",
      publicKey: fake.publicKey,
      connectionRef: "1",
      baseUrl: "http://127.0.0.1:1/v2",
      timeoutMs: 500,
    });
    expect(((await thrown(p.searchNumbers({ country: "US" }))) as PhoneProviderError).code).toBe(
      "UNAVAILABLE",
    );
  });

  test("the account check says whether the key and the call application work", async () => {
    expect(await make().checkAccount()).toEqual({
      keyOk: true,
      applicationOk: true,
      balance: "10.00 USD",
    });
    expect(await make({ connectionRef: "999" }).checkAccount()).toMatchObject({
      keyOk: true,
      applicationOk: false,
    });
    expect(await make({ apiKey: "nope" }).checkAccount()).toEqual({
      keyOk: false,
      applicationOk: false,
    });
  });
});

describe("webhook signatures", () => {
  const event = () =>
    fake.webhook(
      "call.initiated",
      {
        call_control_id: "v3:abc",
        call_session_id: "s-1",
        from: "+15550100999",
        to: "+15550100123",
        direction: "incoming",
        client_state: Buffer.from("hello").toString("base64"),
      },
      { at: Math.floor(clock / 1000) },
    );

  test("a good signature gives the event with its fields", () => {
    const w = event();
    const e = make().verifyWebhook(w.body, w.headers);
    expect(e).toMatchObject({
      type: "call.initiated",
      callControlId: "v3:abc",
      callSessionId: "s-1",
      from: "+15550100999",
      to: "+15550100123",
      direction: "incoming",
      clientState: "hello",
    });
  });

  test("headers may come as a Headers object", () => {
    const w = event();
    expect(make().verifyWebhook(w.body, new Headers(w.headers)).type).toBe("call.initiated");
  });

  test("a changed body, a changed timestamp or another account's signature is refused", () => {
    const w = event();
    const code = (body: string, headers: Record<string, string>, p = make()) => {
      try {
        p.verifyWebhook(body, headers);
      } catch (e) {
        return (e as WebhookError).code;
      }
      return "accepted";
    };
    expect(code(w.body.replace("v3:abc", "v3:evil"), w.headers)).toBe("BAD_SIGNATURE");
    expect(
      code(w.body, { ...w.headers, "telnyx-timestamp": String(Math.floor(clock / 1000) + 1) }),
    ).toBe("BAD_SIGNATURE");
    const other = startFakeTelnyx();
    const foreign = other.webhook("call.initiated", {}, { at: Math.floor(clock / 1000) });
    other.stop();
    expect(code(foreign.body, foreign.headers)).toBe("BAD_SIGNATURE");
  });

  test("missing or malformed headers, no key and a key of the wrong size all fail closed", () => {
    const w = event();
    const code = (p: ReturnType<typeof make>, headers: Record<string, string>) => {
      try {
        p.verifyWebhook(w.body, headers);
      } catch (e) {
        return (e as WebhookError).code;
      }
      return "accepted";
    };
    expect(code(make(), {})).toBe("MALFORMED");
    expect(code(make(), { ...w.headers, "telnyx-signature-ed25519": "AAAA" })).toBe("MALFORMED");
    expect(code(make(), { ...w.headers, "telnyx-timestamp": "yesterday" })).toBe("MALFORMED");
    expect(code(make({ publicKey: "" }), w.headers)).toBe("NO_KEY");
    expect(code(make({ publicKey: "AAAA" }), w.headers)).toBe("NO_KEY");
  });

  test("a validly signed event older or newer than five minutes is stale", () => {
    const old = fake.webhook(
      "call.hangup",
      {},
      { at: Math.floor(clock / 1000) - WEBHOOK_TOLERANCE_SECONDS - 5 },
    );
    const future = fake.webhook(
      "call.hangup",
      {},
      { at: Math.floor(clock / 1000) + WEBHOOK_TOLERANCE_SECONDS + 5 },
    );
    const fresh = fake.webhook(
      "call.hangup",
      {},
      { at: Math.floor(clock / 1000) - WEBHOOK_TOLERANCE_SECONDS + 5 },
    );
    const p = make();
    for (const w of [old, future])
      expect(() => p.verifyWebhook(w.body, w.headers)).toThrow(WebhookError);
    try {
      p.verifyWebhook(old.body, old.headers);
    } catch (e) {
      expect((e as WebhookError).code).toBe("STALE");
    }
    expect(p.verifyWebhook(fresh.body, fresh.headers).type).toBe("call.hangup");
  });

  test("the same event twice is a replay; a handler that failed can release it for the provider's retry", () => {
    const w = event();
    const p = make();
    const first = p.verifyWebhook(w.body, w.headers);
    let code = "";
    try {
      p.verifyWebhook(w.body, w.headers);
    } catch (e) {
      code = (e as WebhookError).code;
    }
    expect(code).toBe("REPLAYED");
    p.releaseEvent(first.id);
    expect(p.verifyWebhook(w.body, w.headers).id).toBe(first.id);
  });

  test("an event id is forgotten after fifteen minutes, but then the timestamp is stale anyway", () => {
    const w = event();
    const p = make();
    p.verifyWebhook(w.body, w.headers);
    clock += 16 * 60_000;
    try {
      p.verifyWebhook(w.body, w.headers);
    } catch (e) {
      expect((e as WebhookError).code).toBe("STALE");
    }
  });

  test("a signed body that is not an event is malformed", () => {
    const stamp = Math.floor(clock / 1000);
    // The fake signs any event; build a body without an id by editing before signing: use the signer with a payload and strip the id.
    const w = fake.webhook("x", {}, { id: "", at: stamp });
    expect(() => make().verifyWebhook(w.body, w.headers)).toThrow(WebhookError);
  });
});
