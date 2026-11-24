// The Resend adapter against a fake HTTP server built from the request and response shapes of Resend's documentation
// (https://resend.com/docs/api-reference/emails/list-received-emails, .../retrieve-received-email, .../domains/get-domain,
// https://resend.com/docs/send-with-smtp). No call leaves this machine: there is no account here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MailConnectError } from "../imap-connect";
import { createResendProvider, addressOf, RESEND_SMTP, type SmtpTransport } from "./resend";
import { RAW_LIMIT } from "./provider";

const KEY = "re_test_key_for_unit_tests";
const RAW =
  "From: ana@example.invalid\r\nTo: bot-1a2b@bots.example.invalid\r\nSubject: Hello\r\n\r\nHi there\r\n";

type Seen = { path: string; query: string; auth: string | null };
const seen: Seen[] = [];
let mode: "ok" | "unauthorized" | "limited" | "slow" | "no-raw" | "huge" | "html" = "ok";
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      seen.push({ path: u.pathname, query: u.search, auth: req.headers.get("authorization") });
      if (mode === "unauthorized") return new Response("nope", { status: 401 });
      if (mode === "limited") return new Response("slow down", { status: 429 });
      if (mode === "slow") await new Promise((r) => setTimeout(r, 400));
      if (mode === "html") return new Response("<html>", { status: 200 });
      const json = (v: unknown) => Response.json(v);
      if (u.pathname === "/domains")
        return json({
          object: "list",
          has_more: false,
          data: [
            { id: "d-other", name: "other.example.invalid", status: "verified" },
            { id: "d-1", name: "bots.example.invalid", status: "verified", capabilities: {} },
          ],
        });
      if (u.pathname === "/domains/d-1")
        return json({
          object: "domain",
          id: "d-1",
          name: "bots.example.invalid",
          status: "verified",
          capabilities: { sending: "enabled", receiving: "disabled" },
          records: [
            {
              record: "SPF",
              name: "send",
              type: "MX",
              value: "feedback-smtp.example.invalid",
              ttl: "Auto",
              status: "verified",
              priority: 10,
            },
            {
              record: "DKIM",
              name: "resend._domainkey",
              type: "TXT",
              value: "p=abc",
              ttl: "Auto",
              status: "not_started",
            },
          ],
        });
      if (u.pathname === "/emails/receiving")
        return json({
          object: "list",
          has_more: u.searchParams.get("before") === "cursor-1",
          data: [
            {
              id: "r-2",
              to: ["Bot <Bot-1A2B@bots.example.invalid>"],
              from: "ana@example.invalid",
              created_at: "2026-11-22T10:02:00.000Z",
              subject: "Second",
              bcc: ["hidden@bots.example.invalid"],
              cc: ["bot-1a2b@bots.example.invalid"],
              reply_to: [],
              message_id: "<2@example.invalid>",
              attachments: [],
            },
            {
              id: "r-1",
              to: ["bot-3c4d@bots.example.invalid"],
              from: "ana@example.invalid",
              created_at: "2026-11-22T10:01:00.000Z",
              subject: "First",
              bcc: [],
              cc: [],
              reply_to: [],
              message_id: "<1@example.invalid>",
              attachments: [],
            },
          ],
        });
      if (u.pathname === "/emails/receiving/r-1") {
        if (mode === "no-raw")
          return json({ object: "email", id: "r-1", raw: null, authentication: null });
        return json({
          object: "email",
          id: "r-1",
          authentication: { spf: "pass", dkim: "fail", dmarc: "weird" },
          raw: {
            download_url: `${base}/signed/raw-1?sig=abc`,
            expires_at: "2026-11-22T11:00:00.000Z",
          },
          html: "<p>ignored</p>",
        });
      }
      if (u.pathname === "/signed/raw-1") {
        if (mode === "huge")
          return new Response(new Uint8Array(RAW_LIMIT + 1), {
            headers: { "content-length": String(RAW_LIMIT + 1) },
          });
        return new Response(RAW);
      }
      return new Response("missing", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

const provider = (o: Partial<Parameters<typeof createResendProvider>[0]> = {}) =>
  createResendProvider({ apiKey: KEY, baseUrl: base, assertHost: async () => {}, ...o });
const reset = (m: typeof mode = "ok") => {
  seen.length = 0;
  mode = m;
};

describe("addressOf", () => {
  test("takes the address out of a display name and lower-cases it", () => {
    expect(addressOf("Bot <Bot-1A2B@Bots.Example.invalid>")).toBe("bot-1a2b@bots.example.invalid");
    expect(addressOf(" ana@example.invalid ")).toBe("ana@example.invalid");
    expect(addressOf(undefined)).toBe("");
  });
});

describe("domainStatus", () => {
  test("finds the domain by name and reads its capabilities and records", async () => {
    reset();
    const s = await provider().domainStatus("Bots.Example.invalid");
    expect(s).toEqual({
      found: true,
      state: "verified",
      sending: true,
      receiving: false,
      records: [
        {
          purpose: "SPF",
          type: "MX",
          name: "send",
          value: "feedback-smtp.example.invalid",
          priority: 10,
          verified: true,
        },
        {
          purpose: "DKIM",
          type: "TXT",
          name: "resend._domainkey",
          value: "p=abc",
          verified: false,
        },
      ],
    });
    expect(seen.map((x) => x.path)).toEqual(["/domains", "/domains/d-1"]);
    expect(seen.every((x) => x.auth === `Bearer ${KEY}`)).toBe(true);
  });
  test("a domain the provider does not have is not found", async () => {
    reset();
    expect(await provider().domainStatus("nope.example.invalid")).toEqual({ found: false });
  });
});

describe("poll", () => {
  test("first look: the newest page, oldest first, nothing more to fetch", async () => {
    reset();
    const r = await provider().poll(null, 50);
    expect(r.items.map((i) => i.ref)).toEqual(["r-1", "r-2"]);
    expect(r.cursor).toBe("r-2");
    expect(r.more).toBe(false);
    expect(seen[0]!.query).toBe("?limit=50");
  });
  test("with a cursor it asks for what is newer, and reports that more is waiting", async () => {
    reset();
    const r = await provider().poll("cursor-1", 20);
    expect(seen[0]!.query).toBe("?limit=20&before=cursor-1");
    expect(r.more).toBe(true);
    expect(r.cursor).toBe("r-2");
  });
  test("every recipient (to, cc, bcc) is an address, lower case and once", async () => {
    reset();
    const r = await provider().poll(null, 50);
    expect(r.items[1]!.recipients).toEqual([
      "bot-1a2b@bots.example.invalid",
      "hidden@bots.example.invalid",
    ]);
  });
  test("limit is kept between 1 and 100", async () => {
    reset();
    await provider().poll(null, 5000);
    expect(seen[0]!.query).toBe("?limit=100");
  });
});

describe("fetchRaw", () => {
  test("downloads the source without the key and reads the authentication results", async () => {
    reset();
    const m = await provider().fetchRaw("r-1");
    expect(Buffer.from(m.raw).toString()).toBe(RAW);
    // Anything the provider is not sure of reads as unknown.
    expect(m.authentication).toEqual({ spf: "pass", dkim: "fail", dmarc: "unknown" });
    const download = seen.find((s) => s.path === "/signed/raw-1")!;
    expect(download.auth).toBeNull();
    expect(seen.find((s) => s.path === "/emails/receiving/r-1")!.auth).toBe(`Bearer ${KEY}`);
  });
  test("a message with no original source is an error, not an empty message", async () => {
    reset("no-raw");
    await expect(provider().fetchRaw("r-1")).rejects.toMatchObject({ code: "NO_RAW" });
  });
  test("a source over the limit is refused", async () => {
    reset("huge");
    await expect(provider().fetchRaw("r-1")).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  test("a message the provider does not have is NOT_FOUND", async () => {
    reset();
    await expect(provider().fetchRaw("r-404")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("failures say the same fixed sentences, never the provider's words", () => {
  test("401 is AUTH", async () => {
    reset("unauthorized");
    const e = (await provider()
      .poll(null, 5)
      .catch((x) => x)) as MailConnectError;
    expect(e).toBeInstanceOf(MailConnectError);
    expect(e.code).toBe("AUTH");
    expect(e.safe).not.toContain("nope");
    expect(e.safe).not.toContain(KEY);
  });
  test("429 is RATE_LIMITED", async () => {
    reset("limited");
    await expect(provider().poll(null, 5)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  test("a slow provider times out", async () => {
    reset("slow");
    await expect(provider({ timeoutMs: 50 }).poll(null, 5)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
  test("an answer that is not JSON is a provider error", async () => {
    reset("html");
    await expect(provider().poll(null, 5)).rejects.toMatchObject({ code: "MAIL_ERROR" });
  });
  test("the address policy decides before anything is sent: a private address is blocked", async () => {
    reset();
    // The real policy (no `assertHost` override) refuses the address of this machine.
    const strict = createResendProvider({ apiKey: KEY, baseUrl: base });
    await expect(strict.poll(null, 5)).rejects.toMatchObject({ code: "BLOCKED_URL" });
    expect(seen).toHaveLength(0);
  });
});

describe("send (SMTP)", () => {
  const capture = () => {
    const sent: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
    const log: { apiKey?: string; closed: number } = { closed: 0 };
    const smtp = async (apiKey: string): Promise<SmtpTransport> => {
      log.apiKey = apiKey;
      return {
        async sendMail(m) {
          sent.push(m);
        },
        close() {
          log.closed++;
        },
      };
    };
    return { sent, log, smtp };
  };
  test("writes the threading headers itself and sends exactly those bytes", async () => {
    const c = capture();
    const hosts: string[] = [];
    const p = provider({ smtp: c.smtp, assertHost: async (h) => void hosts.push(h) });
    const out = await p.send({
      from: { name: "Helper Bot", address: "helper-1a2b@bots.example.invalid" },
      to: ["ana@example.invalid"],
      subject: "Re: Hello",
      text: "Thanks!",
      messageId: "out-1@bots.example.invalid",
      inReplyTo: "1@example.invalid",
      references: ["0@example.invalid", "1@example.invalid"],
    });
    expect(c.sent).toHaveLength(1);
    const text = c.sent[0]!.raw.toString();
    expect(text).toContain("Message-ID: <out-1@bots.example.invalid>");
    expect(text).toContain("In-Reply-To: <1@example.invalid>");
    expect(text).toContain("References: <0@example.invalid> <1@example.invalid>");
    expect(text).toContain("Helper Bot");
    expect(c.sent[0]!.envelope).toEqual({
      from: "helper-1a2b@bots.example.invalid",
      to: ["ana@example.invalid"],
    });
    // The caller stores the very bytes that went out.
    expect(Buffer.from(out.raw).equals(c.sent[0]!.raw)).toBe(true);
    // The key is the SMTP password, and the SMTP host went through the address policy.
    expect(c.log.apiKey).toBe(KEY);
    expect(hosts).toContain(RESEND_SMTP.host);
    expect(c.log.closed).toBe(1);
  });
  test("a refused password is AUTH with a fixed sentence", async () => {
    const e = Object.assign(new Error("535 secret detail"), { code: "EAUTH" });
    const p = provider({
      smtp: async () => ({
        async sendMail() {
          throw e;
        },
        close() {},
      }),
    });
    const err = (await p
      .send({
        from: { name: "B", address: "b@bots.example.invalid" },
        to: ["a@example.invalid"],
        subject: "s",
        text: "t",
        messageId: "x@bots.example.invalid",
      })
      .catch((x) => x)) as MailConnectError;
    expect(err.code).toBe("AUTH");
    expect(err.safe).not.toContain("secret detail");
  });
});
