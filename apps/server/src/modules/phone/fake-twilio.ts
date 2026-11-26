/**
 * A fake Twilio for tests, built from the documented shapes only (docs/operations/phone.md lists the pages): an HTTP server on this
 * machine that answers the REST calls `twilio.ts` makes (HTTP basic with the Account SID and Auth Token, form bodies, JSON answers), a
 * webhook signer that makes `X-Twilio-Signature` the way Twilio's helper libraries do (HMAC-SHA1 over the address and the sorted form
 * parameters, base64), and a Media Streams driver that speaks the socket's documented messages (`connected`, `start`, `media`, `dtmf`,
 * `stop`; `streamSid` on what is sent back). It keeps what it was asked so a test can say what Zetta did. Numbers are fictional
 * (`+1 202 555 01xx`; Brazil `+55 11 5550 02xx`: another range than the fake Telnyx, so both can be used in one test).
 */
import { createHmac } from "node:crypto";

export type FakeTwilioCall = {
  path: string;
  method: string;
  /** The form body, as name to values. */
  form: Record<string, string[]>;
  auth: string;
};

export type FakeTwilio = {
  /** `http://127.0.0.1:<port>/2010-04-01`: pass it as `baseUrl` of the provider. */
  baseUrl: string;
  accountSid: string;
  authToken: string;
  /** The address the installation says Twilio calls (what a webhook is signed with). */
  publicUrl: string;
  calls: FakeTwilioCall[];
  /** Calls created with `POST /Calls.json`, with the sid the fake gave each. */
  placed: { sid: string; form: Record<string, string[]> }[];
  /** Updates of calls (`POST /Calls/{sid}.json`). */
  updates: { sid: string; form: Record<string, string[]> }[];
  /** Numbers the account holds now (E.164 to sid) and the voice address each has. */
  held: Map<string, string>;
  voiceUrls: Map<string, string>;
  /** Countries whose numbers carry `address_requirements: "any"` (a regulatory bundle is needed, as in Brazil). */
  bundleCountries: Set<string>;
  failNext(status: number): void;
  /** A signed form webhook. `path` is `/api/phone/twilio/voice` or `/api/phone/twilio/status`. */
  webhook(
    path: string,
    params: Record<string, string>,
    o?: { token?: string; url?: string; host?: string },
  ): { body: string; headers: Record<string, string>; path: string };
  /** The webhook of a call that rings on one of our numbers. */
  voice(callSid: string, from: string, to: string): ReturnType<FakeTwilio["webhook"]>;
  /** A call status callback (`in-progress`, `completed`...). */
  status(callSid: string, callStatus: string, sequence?: number): ReturnType<FakeTwilio["webhook"]>;
  /** The answer of the answering machine detection. */
  machine(callSid: string, answeredBy: string): ReturnType<FakeTwilio["webhook"]>;
  stop(): void;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** The signature of Twilio's helper libraries, written again here on purpose: the adapter's own function is not what the test trusts. */
export function signLikeTwilio(token: string, url: string, params: Record<string, string>) {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64");
}

export function startFakeTwilio(
  o: {
    accountSid?: string;
    authToken?: string;
    publicUrl?: string;
  } = {},
): FakeTwilio {
  const accountSid = o.accountSid ?? `AC${"0".repeat(32)}`;
  const authToken = o.authToken ?? "test-token";
  const publicUrl = (o.publicUrl ?? "https://zetta.example.invalid").replace(/\/$/, "");
  let counter = 0;
  let failure: number | null = null;
  const sidOf = (prefix: string) => `${prefix}${String(++counter).padStart(32, "0")}`;
  const state: FakeTwilio = {
    baseUrl: "",
    accountSid,
    authToken,
    publicUrl,
    calls: [],
    placed: [],
    updates: [],
    held: new Map(),
    voiceUrls: new Map(),
    bundleCountries: new Set(),
    failNext: (status) => {
      failure = status;
    },
    webhook(path, params, opts = {}) {
      const url = opts.url ?? `${publicUrl}${path}`;
      const body = new URLSearchParams(params).toString();
      return {
        path,
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": signLikeTwilio(opts.token ?? authToken, url, params),
          host: opts.host ?? new URL(publicUrl).host,
        },
      };
    },
    voice: (callSid, from, to) =>
      state.webhook("/api/phone/twilio/voice", {
        CallSid: callSid,
        AccountSid: accountSid,
        From: from,
        To: to,
        CallStatus: "ringing",
        Direction: "inbound",
        ApiVersion: "2010-04-01",
      }),
    status: (callSid, callStatus, sequence = 0) =>
      state.webhook("/api/phone/twilio/status", {
        CallSid: callSid,
        AccountSid: accountSid,
        CallStatus: callStatus,
        SequenceNumber: String(sequence),
        CallbackSource: "call-progress-events",
      }),
    machine: (callSid, answeredBy) =>
      state.webhook("/api/phone/twilio/status", {
        CallSid: callSid,
        AccountSid: accountSid,
        AnsweredBy: answeredBy,
        MachineDetectionDuration: "1200",
      }),
    stop: () => server.stop(true),
  };

  const free = (country: string, area?: string) => {
    for (let i = 0; i < 100; i++) {
      const xx = String(i).padStart(2, "0");
      const e164 =
        country === "BR" ? `+55${area || "11"}555002${xx}` : `+1${area || "202"}55501${xx}`;
      if (!state.held.has(e164)) return e164;
    }
    return "";
  };
  const numberJson = (e164: string) => {
    const sid = state.held.get(e164)!;
    return {
      sid,
      phone_number: e164,
      voice_url: state.voiceUrls.get(sid) ?? "",
      capabilities: { voice: true, sms: false, mms: false, fax: false },
    };
  };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/2010-04-01/, "");
      const text = await req.text();
      const form: Record<string, string[]> = {};
      for (const [k, v] of new URLSearchParams(text)) (form[k] ??= []).push(v);
      const auth = req.headers.get("authorization") ?? "";
      state.calls.push({ path: path + url.search, method: req.method, form, auth });
      const expected = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
      if (auth !== expected) return json({ code: 20003, message: "Authenticate" }, 401);
      if (failure !== null) {
        const status = failure;
        failure = null;
        return json({ code: 20500, message: "failure" }, status);
      }
      const root = `/Accounts/${accountSid}`;
      if (!path.startsWith(root)) return json({ code: 20404 }, 404);
      const rest = path.slice(root.length);

      const search = /^\/AvailablePhoneNumbers\/([A-Z]{2})\/Local\.json$/.exec(rest);
      if (req.method === "GET" && search) {
        const country = search[1]!;
        const n = free(country, url.searchParams.get("AreaCode") || undefined);
        return json({
          available_phone_numbers: n
            ? [
                {
                  friendly_name: n,
                  phone_number: n,
                  iso_country: country,
                  address_requirements: state.bundleCountries.has(country) ? "any" : "none",
                  beta: false,
                  capabilities: { voice: true, SMS: false, MMS: false, fax: false },
                },
              ]
            : [],
        });
      }
      if (rest === "/IncomingPhoneNumbers.json" && req.method === "POST") {
        const e164 = form.PhoneNumber?.[0];
        if (!e164 || !form.VoiceUrl?.[0]) return json({ code: 21452 }, 400);
        const country = e164.startsWith("+55") ? "BR" : "US";
        if (state.bundleCountries.has(country) && !form.BundleSid?.[0])
          return json({ code: 21649, message: "Bundle required" }, 400);
        const sid = sidOf("PN");
        state.held.set(e164, sid);
        state.voiceUrls.set(sid, form.VoiceUrl[0]);
        return json(numberJson(e164), 201);
      }
      if (rest === "/IncomingPhoneNumbers.json" && req.method === "GET") {
        const wanted = url.searchParams.get("PhoneNumber");
        const rows = [...state.held.keys()].filter(
          (e) => !wanted || e.includes(wanted.replace(/^\+/, "")),
        );
        return json({ page: 0, incoming_phone_numbers: rows.map(numberJson) });
      }
      const num = /^\/IncomingPhoneNumbers\/([^/]+)\.json$/.exec(rest);
      if (num) {
        const e164 = [...state.held].find(([, sid]) => sid === num[1])?.[0];
        if (!e164) return json({ code: 20404 }, 404);
        if (req.method === "GET") return json(numberJson(e164));
        if (req.method === "POST") {
          if (form.VoiceUrl?.[0]) state.voiceUrls.set(num[1]!, form.VoiceUrl[0]);
          return json(numberJson(e164));
        }
        if (req.method === "DELETE") {
          state.held.delete(e164);
          return new Response(null, { status: 204 });
        }
      }
      if (rest === "/Calls.json" && req.method === "POST") {
        if (!form.To?.[0] || !form.From?.[0] || !(form.Twiml?.[0] || form.Url?.[0]))
          return json({ code: 21205 }, 400);
        const sid = sidOf("CA");
        state.placed.push({ sid, form });
        return json({ sid, status: "queued", to: form.To[0], from: form.From[0] }, 201);
      }
      const callUpdate = /^\/Calls\/([^/]+)\.json$/.exec(rest);
      if (callUpdate && req.method === "POST") {
        state.updates.push({ sid: callUpdate[1]!, form });
        return json({ sid: callUpdate[1], status: form.Status?.[0] ?? "in-progress" });
      }
      if (rest === ".json" && req.method === "GET")
        return json({ sid: accountSid, status: "active" });
      if (rest === "/Balance.json" && req.method === "GET")
        return json({ account_sid: accountSid, balance: "10.0000", currency: "USD" });
      return json({ code: 20404, message: "Not found" }, 404);
    },
  });
  state.baseUrl = `http://127.0.0.1:${server.port}/2010-04-01`;
  return state;
}

/** The stream address and the custom parameters out of the TwiML an answer carried (`<Connect><Stream url><Parameter/></Stream>`). */
export function parseStreamTwiml(twiml: string): { url: string; params: Record<string, string> } {
  const unescape = (v: string) =>
    v
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  const url = /<Stream url="([^"]*)"/.exec(twiml)?.[1] ?? "";
  const params: Record<string, string> = {};
  for (const m of twiml.matchAll(/<Parameter name="([^"]*)" value="([^"]*)"\/>/g))
    params[unescape(m[1]!)] = unescape(m[2]!);
  return { url: unescape(url), params };
}

export type FakeStream = {
  ws: WebSocket;
  sid: string;
  /** Every message Zetta sent on the socket, parsed. */
  received: Record<string, unknown>[];
  closed: { code: number | null };
  /** `connected` and `start` as Twilio sends them, with the custom parameters of the TwiML. */
  open(params: Record<string, string>): void;
  media(payloadBase64: string): void;
  dtmf(digit: string): void;
  stop(): void;
};

/** Plays Twilio's side of a Media Streams socket against a real WebSocket address. */
export async function connectStream(
  address: string,
  o: { accountSid: string; callSid: string; streamSid?: string },
): Promise<FakeStream> {
  const ws = new WebSocket(address);
  const sid = o.streamSid ?? `MZ${"1".repeat(32)}`;
  let seq = 0;
  let chunk = 0;
  const received: Record<string, unknown>[] = [];
  const closed = { code: null as number | null };
  ws.addEventListener("message", (e) => {
    try {
      received.push(JSON.parse(String(e.data)));
    } catch {
      /* not JSON */
    }
  });
  ws.addEventListener("close", (e) => (closed.code = e.code));
  await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
  const send = (m: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ ...m, sequenceNumber: String(++seq), streamSid: sid }));
  };
  return {
    ws,
    sid,
    received,
    closed,
    open(params) {
      ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
      send({
        event: "start",
        start: {
          accountSid: o.accountSid,
          streamSid: sid,
          callSid: o.callSid,
          tracks: ["inbound"],
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
          customParameters: params,
        },
      });
    },
    media(payload) {
      chunk += 1;
      send({
        event: "media",
        media: { track: "inbound", chunk: String(chunk), timestamp: String(chunk * 20), payload },
      });
    },
    dtmf(digit) {
      send({ event: "dtmf", dtmf: { track: "inbound", digit } });
    },
    stop() {
      send({ event: "stop", stop: { accountSid: o.accountSid, callSid: o.callSid } });
    },
  };
}
