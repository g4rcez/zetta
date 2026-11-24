/**
 * A fake Telnyx for tests: an HTTP server on this machine that answers the documented shapes of the calls `telnyx.ts` makes, and a
 * signer that makes webhooks the way Telnyx signs them (Ed25519 over `<timestamp>|<body>`). It keeps what it was asked, so a test can
 * say what Zetta did. Numbers are in reserved fictional ranges (`+1 555 01xx`; Brazil: `+55 11 5550 01xx`).
 *
 * `reviewCountries` makes an order of that country wait in review (the way a Brazilian order does) until `approveOrder` is called.
 */
import { generateKeyPairSync, sign } from "node:crypto";

export type FakeCall = { path: string; method: string; body: unknown; auth: string };

export type FakeTelnyx = {
  /** `http://127.0.0.1:<port>` : pass it as `baseUrl` of the provider. */
  baseUrl: string;
  apiKey: string;
  /** The account's public key, base64 of the 32 raw bytes: what an administrator pastes in Studio. */
  publicKey: string;
  connectionRef: string;
  calls: FakeCall[];
  /** The calls dialled (`POST /calls`) with the id the fake gave each, so a test can speak for the other end. */
  placed: { id: string; body: Record<string, unknown> }[];
  /** Numbers the account holds now (E.164 -> id). */
  held: Map<string, string>;
  /** Where each held number routes (number id -> connection id); a number bought elsewhere starts with none. */
  routes: Map<string, string | null>;
  orders: Map<string, { e164: string; status: "pending" | "success" | "failure" }>;
  reviewCountries: Set<string>;
  /** The next request answers with this status (then back to normal). */
  failNext(status: number): void;
  approveOrder(orderId: string): void;
  rejectOrder(orderId: string): void;
  /** A signed webhook as Telnyx would send it. `at` is the timestamp in seconds; `id` is the event id. */
  webhook(
    type: string,
    payload?: Record<string, unknown>,
    o?: { id?: string; at?: number },
  ): { body: string; headers: Record<string, string> };
  stop(): void;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function startFakeTelnyx(
  o: { apiKey?: string; connectionRef?: string; now?: () => number } = {},
): FakeTelnyx {
  const apiKey = o.apiKey ?? "KEY-test-0000000000";
  const connectionRef = o.connectionRef ?? "1111111111111111111";
  const now = o.now ?? Date.now;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  let counter = 0;
  let failure: number | null = null;
  const state: FakeTelnyx = {
    baseUrl: "",
    apiKey,
    publicKey: Buffer.from(rawPublic).toString("base64"),
    connectionRef,
    calls: [],
    placed: [],
    held: new Map(),
    routes: new Map(),
    orders: new Map(),
    reviewCountries: new Set(),
    failNext: (status) => {
      failure = status;
    },
    approveOrder(id) {
      const order = state.orders.get(id);
      if (order) {
        order.status = "success";
        state.held.set(order.e164, `num-${id}`);
        state.routes.set(`num-${id}`, connectionRef);
      }
    },
    rejectOrder(id) {
      const order = state.orders.get(id);
      if (order) order.status = "failure";
    },
    webhook(type, payload = {}, opts = {}) {
      const body = JSON.stringify({
        data: {
          record_type: "event",
          id: opts.id ?? `evt-${++counter}`,
          event_type: type,
          occurred_at: new Date(now()).toISOString(),
          payload,
        },
        meta: { attempt: 1, delivered_to: "https://zetta.example.invalid/api/phone/webhook" },
      });
      const stamp = String(opts.at ?? Math.floor(now() / 1000));
      const signature = sign(null, Buffer.from(`${stamp}|${body}`, "utf8"), privateKey);
      return {
        body,
        headers: {
          "telnyx-signature-ed25519": signature.toString("base64"),
          "telnyx-timestamp": stamp,
        },
      };
    },
    stop: () => server.stop(true),
  };

  const free = (country: string, area?: string) => {
    for (let i = 0; i < 100; i++) {
      const xx = String(i).padStart(2, "0");
      const e164 =
        country === "BR" ? `+55${area || "11"}555001${xx}` : `+1${area || "415"}55501${xx}`;
      if (!state.held.has(e164) && ![...state.orders.values()].some((x) => x.e164 === e164))
        return e164;
    }
    return "";
  };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/v2/, "");
      const text = await req.text();
      const body = text ? JSON.parse(text) : undefined;
      const auth = req.headers.get("authorization") ?? "";
      state.calls.push({ path: path + url.search, method: req.method, body, auth });
      if (auth !== `Bearer ${apiKey}`) return json({ errors: [{ title: "Unauthorized" }] }, 401);
      if (failure !== null) {
        const status = failure;
        failure = null;
        return json({ errors: [{ title: "failure" }] }, status);
      }

      if (req.method === "GET" && path === "/available_phone_numbers") {
        const country = url.searchParams.get("filter[country_code]") ?? "US";
        const area = url.searchParams.get("filter[national_destination_code]") ?? undefined;
        const n = free(country, area || undefined);
        return json({
          data: n
            ? [
                {
                  record_type: "available_phone_number",
                  phone_number: n,
                  cost_information: { monthly_cost: "1.00", upfront_cost: "0.00", currency: "USD" },
                  features: [{ name: "voice" }],
                },
              ]
            : [],
        });
      }
      if (req.method === "POST" && path === "/number_orders") {
        const e164 = body?.phone_numbers?.[0]?.phone_number as string;
        if (!e164 || body.connection_id !== connectionRef)
          return json({ errors: [{ title: "Invalid" }] }, 422);
        const id = `order-${++counter}`;
        const review = state.reviewCountries.has(e164.startsWith("+55") ? "BR" : "US");
        state.orders.set(id, { e164, status: review ? "pending" : "success" });
        if (!review) {
          state.held.set(e164, `num-${id}`);
          state.routes.set(`num-${id}`, connectionRef);
        }
        return json(
          {
            data: {
              id,
              status: review ? "pending" : "success",
              phone_numbers: [{ phone_number: e164 }],
            },
          },
          201,
        );
      }
      const order = /^\/number_orders\/([^/]+)$/.exec(path);
      if (req.method === "GET" && order) {
        const found = state.orders.get(order[1]!);
        return found ? json({ data: { id: order[1], status: found.status } }) : json({}, 404);
      }
      if (req.method === "GET" && path === "/phone_numbers") {
        const e164 = url.searchParams.get("filter[phone_number]") ?? "";
        const id = state.held.get(e164);
        return json({
          data: id
            ? [
                {
                  id,
                  record_type: "phone_number",
                  phone_number: e164,
                  status: "active",
                  connection_id: state.routes.get(id) ?? null,
                },
              ]
            : [],
        });
      }
      const num = /^\/phone_numbers\/([^/]+)$/.exec(path);
      if (req.method === "PATCH" && num) {
        // Documented: PATCH /phone_numbers/{id} takes connection_id and answers the updated number.
        const e164 = [...state.held].find(([, id]) => id === num[1])?.[0];
        if (!e164) return json({ errors: [{ title: "Not found" }] }, 404);
        if (typeof body?.connection_id !== "string")
          return json({ errors: [{ title: "Invalid" }] }, 422);
        state.routes.set(num[1]!, body.connection_id);
        return json({
          data: {
            id: num[1],
            phone_number: e164,
            status: "active",
            connection_id: body.connection_id,
          },
        });
      }
      if (req.method === "DELETE" && num) {
        for (const [e164, id] of state.held) if (id === num[1]) state.held.delete(e164);
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST" && path === "/calls") {
        if (!body?.to || !body?.from || body.connection_id !== connectionRef)
          return json({ errors: [{ title: "Invalid" }] }, 422);
        const id = `v3:call-${++counter}`;
        state.placed.push({ id, body });
        return json({
          data: { call_control_id: id, call_session_id: `session-${counter}`, is_alive: false },
        });
      }
      if (
        req.method === "POST" &&
        /^\/calls\/[^/]+\/actions\/(answer|reject|hangup|streaming_start)$/.test(path)
      )
        return json({ data: { result: "ok" } });
      if (req.method === "GET" && path === "/balance")
        return json({ data: { balance: "10.00", available_credit: "10.00", currency: "USD" } });
      const app = /^\/call_control_applications\/([^/]+)$/.exec(path);
      if (req.method === "GET" && app)
        return app[1] === connectionRef ? json({ data: { id: connectionRef } }) : json({}, 404);
      return json({ errors: [{ title: "Not found" }] }, 404);
    },
  });
  state.baseUrl = `http://127.0.0.1:${server.port}/v2`;
  return state;
}
