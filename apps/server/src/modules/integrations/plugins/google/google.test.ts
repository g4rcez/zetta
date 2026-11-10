import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getPlugin, type PluginContext } from "../registry";
import { createRoutinePollers } from "../../../features/routine-pollers";
import { newMessages, stripHtml } from "./gmail";
import { configureGoogleForTests, redirectUri } from "./oauth";
import "./index";

let calls: { path: string; query: string; method: string; auth?: string; body: string }[] = [];
let tokenCount = 0,
  tokenMode: "ok" | "revoked" = "ok",
  expiresIn = 3600,
  scopeReply = "";
let challenge = "";
let userEmail = "me@example.com",
  refreshReply = "ref-1";
const revokedRefresh = new Set<string>();
const big = "x".repeat(20_000);
const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const body = await req.text();
    calls.push({
      path: u.pathname,
      query: u.search,
      method: req.method,
      auth: req.headers.get("authorization") ?? undefined,
      body,
    });
    const json = (o: unknown, status = 200) => Response.json(o, { status });
    if (u.pathname === "/token") {
      const f = new URLSearchParams(body);
      if (f.get("grant_type") === "authorization_code") {
        const ok =
          createHash("sha256")
            .update(f.get("code_verifier") ?? "")
            .digest("base64url") === challenge;
        return ok
          ? json({
              access_token: "acc-1",
              refresh_token: refreshReply,
              expires_in: expiresIn,
              scope: scopeReply,
            })
          : json({ error: "invalid_grant" }, 400);
      }
      tokenCount++;
      await Bun.sleep(20);
      return tokenMode === "revoked" || revokedRefresh.has(f.get("refresh_token") ?? "")
        ? json({ error: "invalid_grant" }, 400)
        : json({ access_token: `acc-r${tokenCount}`, expires_in: 3600 });
    }
    if (u.pathname === "/revoke") return json({});
    if (u.pathname === "/userinfo") return json({ email: userEmail });
    if (u.pathname === "/gmail/users/me/messages")
      return json({ messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}aaaaaa` })) });
    if (u.pathname.startsWith("/gmail/users/me/messages/") && u.pathname.endsWith("/send"))
      return json({ id: "sent1" });
    if (u.pathname.startsWith("/gmail/users/me/messages/"))
      return json({
        id: "m1aaaaaa",
        snippet: big,
        payload: {
          mimeType: "text/plain",
          body: { data: Buffer.from(big).toString("base64url") },
          headers: [
            { name: "Subject", value: "S".repeat(900) },
            { name: "From", value: "a@b.c" },
          ],
        },
      });
    if (u.pathname === "/gmail/users/me/drafts") return json({ id: "d1" });
    const path = decodeURIComponent(u.pathname);
    if (path === "/docs/documents/apioff123")
      return json(
        {
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "SERVICE_DISABLED",
                metadata: { activationUrl: "https://evil.example/enable" },
              },
            ],
          },
        },
        403,
      );
    if (path === "/docs/documents/nope12345")
      return json({ error: { code: 403, status: "PERMISSION_DENIED" } }, 403);
    if (path === "/docs/documents/doc12345")
      return json({
        documentId: "doc12345",
        title: "Plan",
        body: {
          content: [
            { sectionBreak: {} },
            {
              paragraph: {
                elements: [{ textRun: { content: "Hello " } }, { textRun: { content: "world\n" } }],
              },
            },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      { content: [{ paragraph: { elements: [{ textRun: { content: "a\n" } }] } }] },
                      { content: [{ paragraph: { elements: [{ textRun: { content: "b\n" } }] } }] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      });
    if (path === "/docs/documents" && req.method === "POST")
      return json({ documentId: "newdoc123" });
    if (path.endsWith(":batchUpdate")) return json({});
    if (path === "/sheets/spreadsheets/sheet12345")
      return json({
        properties: { title: "Budget" },
        sheets: [
          { properties: { title: "Sheet1", gridProperties: { rowCount: 100, columnCount: 6 } } },
        ],
      });
    if (path === "/sheets/spreadsheets/sheet12345/values/Sheet1!A1:B2" && req.method === "GET")
      return json({
        range: "Sheet1!A1:B2",
        values: [
          ["a", "b"],
          ["1", 2],
        ],
      });
    if (path === "/sheets/spreadsheets/sheet12345/values/Sheet1!A1:A1500")
      return json({
        range: "Sheet1!A1:A1500",
        values: Array.from({ length: 1500 }, (_, i) => [`row${i}`]),
      });
    if (path === "/sheets/spreadsheets/sheet12345/values/Sheet1!A1:B2" && req.method === "PUT")
      return json({ updatedRange: "Sheet1!A1:B2", updatedCells: 4 });
    if (path === "/sheets/spreadsheets/sheet12345/values/Sheet1:append")
      return json({ updates: { updatedRange: "Sheet1!A3:B3", updatedRows: 1 } });
    if (path === "/sheets/spreadsheets" && req.method === "POST")
      return json({
        spreadsheetId: "newsheet1",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/newsheet1/edit",
      });
    return json({}, 404);
  },
});
const base = `http://localhost:${fake.port}`;
afterAll(() => {
  fake.stop(true);
  configureGoogleForTests({});
});

const KEYS = { clientId: "cid", clientSecret: "csecret" };
function mkCtx(userId = "u1", start: Record<string, string> = {}) {
  let config: Record<string, string> = { ...KEYS, ...start };
  const ctx: PluginContext = {
    userId,
    get config() {
      return config;
    },
    async setConfig(n) {
      config = { ...n };
    },
  };
  return { ctx, get: () => config };
}
const plugin = getPlugin("google")!;
const accountsOf = (c: { get: () => Record<string, string> }) =>
  JSON.parse(c.get().accounts ?? "[]") as Record<string, string>[];
const tool = (n: string) => plugin.tools!.find((t) => t.name === n)!;
let now = 1_000_000;
beforeEach(() => {
  calls = [];
  revokedRefresh.clear();
  userEmail = "me@example.com";
  refreshReply = "ref-1";
  tokenCount = 0;
  tokenMode = "ok";
  expiresIn = 3600;
  now = 1_000_000;
  process.env.GOOGLE_OAUTH_REDIRECT_BASE = "https://zetta.test";
  configureGoogleForTests({
    authUrl: `${base}/auth`,
    tokenUrl: `${base}/token`,
    revokeUrl: `${base}/revoke`,
    userinfoUrl: `${base}/userinfo`,
    gmailBase: `${base}/gmail`,
    calendarBase: `${base}/cal`,
    driveBase: `${base}/drive`,
    docsBase: `${base}/docs`,
    sheetsBase: `${base}/sheets`,
    now: () => now,
  });
});

const READ = "https://www.googleapis.com/auth/gmail.readonly";
async function connect(
  c: ReturnType<typeof mkCtx>,
  scopes: string[],
  granted: string,
  allowSend = false,
) {
  const { authorizeUrl } = (await plugin.connect!(c.ctx, { scopes, allowSend })) as {
    authorizeUrl: string;
  };
  const u = new URL(authorizeUrl);
  challenge = u.searchParams.get("code_challenge")!;
  scopeReply = granted;
  return u;
}

describe("google oauth", () => {
  test("not configured gives setup instructions", async () => {
    const none = () => mkCtx("u1", { clientId: "", clientSecret: "" }).ctx;
    await expect(plugin.connect!(none(), { scopes: ["gmail.readonly"] })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect((await plugin.status!(none())).state).toBe("error");
  });
  test("authorize URL carries PKCE, state, offline access and incremental scopes; nothing leaks into config view", async () => {
    const c = mkCtx();
    const u = await connect(c, ["gmail.readonly"], READ);
    const q = u.searchParams;
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent select_account");
    expect(q.get("include_granted_scopes")).toBe("true");
    expect(q.get("redirect_uri")).toBe(redirectUri());
    expect(q.get("redirect_uri")).toBe("https://zetta.test/api/plugins/google/callback");
    expect(q.get("scope")).toBe(`openid email ${READ}`);
    expect(q.get("client_secret")).toBeNull();
    expect(c.get().pending).not.toContain(q.get("state")!); // only the hash of state is stored
  });
  test("rejects unknown scope and allowSend without send scope", async () => {
    await expect(plugin.connect!(mkCtx().ctx, { scopes: ["gmail.all"] })).rejects.toMatchObject({
      code: "INVALID_SCOPE",
    });
    await expect(
      plugin.connect!(mkCtx().ctx, { scopes: ["gmail.readonly"], allowSend: true }),
    ).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  });
  test("callback: bad state rejected without consuming, good state works once, replay rejected", async () => {
    const c = mkCtx();
    const u = await connect(c, ["gmail.readonly"], READ);
    await expect(
      plugin.callback!(c.ctx, new URLSearchParams({ code: "x", state: "forged" })),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(c.get().pending).toBeDefined();
    const ok = new URLSearchParams({ code: "c1", state: u.searchParams.get("state")! });
    await plugin.callback!(c.ctx, ok);
    expect(accountsOf(c)).toMatchObject([
      { refreshToken: "ref-1", email: "me@example.com", scopes: "gmail.readonly" },
    ]);
    expect(c.get().pending).toBeUndefined();
    await expect(plugin.callback!(c.ctx, ok)).rejects.toMatchObject({ code: "INVALID_STATE" });
    // another user never has the pending flow
    await expect(plugin.callback!(mkCtx("u2").ctx, ok)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });
  test("callback: wrong PKCE verifier at Google fails; expiry and denial consume the state", async () => {
    const c = mkCtx();
    const u = await connect(c, ["gmail.readonly"], READ);
    challenge = "other";
    await expect(
      plugin.callback!(
        c.ctx,
        new URLSearchParams({ code: "c", state: u.searchParams.get("state")! }),
      ),
    ).rejects.toMatchObject({ code: "EXCHANGE_FAILED" });
    const d = mkCtx();
    const u2 = await connect(d, ["gmail.readonly"], READ);
    now += 11 * 60_000;
    await expect(
      plugin.callback!(
        d.ctx,
        new URLSearchParams({ code: "c", state: u2.searchParams.get("state")! }),
      ),
    ).rejects.toMatchObject({ code: "STATE_EXPIRED" });
    expect(d.get().pending).toBeUndefined();
    const e = mkCtx();
    const u3 = await connect(e, ["gmail.readonly"], READ);
    await expect(
      plugin.callback!(
        e.ctx,
        new URLSearchParams({ error: "access_denied", state: u3.searchParams.get("state")! }),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  test("refresh is single-flight, skewed, and persisted", async () => {
    const c = mkCtx("u1", {
      refreshToken: "ref-1",
      scopes: "gmail.readonly",
      accessToken: "old",
      expiresAt: String(now + 30_000),
    }); // inside the 60s skew
    await Promise.all(
      [1, 2, 3, 4].map(() => tool("gmail_read_message").handler(c.ctx, { id: "m1aaaaaa" })),
    );
    expect(tokenCount).toBe(1);
    expect(accountsOf(c)[0]!.accessToken).toBe("acc-r1");
    expect(
      calls.filter((x) => x.path.includes("/messages/")).every((x) => x.auth === "Bearer acc-r1"),
    ).toBe(true);
    await tool("gmail_read_message").handler(c.ctx, { id: "m1aaaaaa" });
    expect(tokenCount).toBe(1); // cached while fresh
  });
  test("revoked refresh token clears credentials and reports needs-auth", async () => {
    const c = mkCtx("u1", {
      refreshToken: "ref-1",
      scopes: "gmail.readonly",
      email: "me@example.com",
    });
    tokenMode = "revoked";
    await expect(tool("gmail_search").handler(c.ctx, { query: "x" })).rejects.toMatchObject({
      code: "NEEDS_AUTH",
    });
    expect(c.get().refreshToken).toBeUndefined();
    expect((await plugin.status!(c.ctx)).state).toBe("needs-auth");
  });
  test("disconnect revokes at Google and wipes the tokens but keeps the OAuth client", async () => {
    const c = mkCtx("u1", { refreshToken: "ref-1" });
    await plugin.disconnect!(c.ctx);
    expect(calls.some((x) => x.path === "/revoke" && x.body === "token=ref-1")).toBe(true);
    expect(c.get()).toEqual(KEYS);
  });
});

describe("google tools", () => {
  const fresh = (scopes: string, extra: Record<string, string> = {}) =>
    mkCtx("u1", {
      refreshToken: "r",
      accessToken: "a",
      expiresAt: String(now + 3_600_000),
      scopes,
      ...extra,
    });
  test("scope gating", async () => {
    await expect(
      tool("gmail_search").handler(fresh("drive.file").ctx, { query: "x" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("gmail_create_draft").handler(fresh("gmail.readonly").ctx, {
        to: ["a@b.co"],
        subject: "s",
        body: "b",
      }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("calendar_create_event").handler(fresh("calendar.events.readonly").ctx, {
        title: "t",
        start: "2026-01-01T10:00:00Z",
        end: "2026-01-01T11:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("drive_search").handler(fresh("gmail.readonly").ctx, { query: "x" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    expect(calls.length).toBe(0);
  });
  test("send needs scope AND allowSend, validates recipients, and is rate limited", async () => {
    const args = { to: ["a@b.co"], subject: "hi", body: "yo" };
    await expect(
      tool("gmail_send").handler(fresh("gmail.readonly", { allowSend: "true" }).ctx, args),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(tool("gmail_send").handler(fresh("gmail.send").ctx, args)).rejects.toMatchObject({
      code: "SEND_DISABLED",
    });
    await expect(
      tool("gmail_send").handler(fresh("gmail.send", { allowSend: "true" }).ctx, {
        ...args,
        to: ["a@b.co\r\nBcc: x@y.z"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(calls.length).toBe(0);
    const ok = fresh("gmail.send", { allowSend: "true" });
    const out = (await tool("gmail_send").handler(ok.ctx, args)) as { status: string };
    expect(out.status).toBe("sent");
    for (let i = 0; i < 9; i++) await tool("gmail_send").handler(ok.ctx, args);
    await expect(tool("gmail_send").handler(ok.ctx, args)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
  test("draft rejects header injection in subject", async () => {
    await expect(
      tool("gmail_create_draft").handler(fresh("gmail.compose").ctx, {
        to: ["a@b.co"],
        subject: "x\nBcc: e@e.ee",
        body: "b",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(
      await tool("gmail_create_draft").handler(fresh("gmail.compose").ctx, {
        to: ["a@b.co"],
        subject: "ok",
        body: "b",
      }),
    ).toMatchObject({ status: "draft_created" });
  });
  test("outputs are bounded and marked untrusted", async () => {
    const list = (await tool("gmail_search").handler(fresh("gmail.readonly").ctx, {
      query: "x",
      max: 50,
    })) as string;
    expect(list.length).toBeLessThanOrEqual(7500);
    expect(list).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(JSON.parse(list).messages[0].subject.length).toBeLessThan(200);
    const doc = (await tool("gmail_read_message").handler(fresh("gmail.readonly").ctx, {
      id: "m1aaaaaa",
    })) as string;
    expect(doc.length).toBeLessThanOrEqual(7500);
    expect(doc.startsWith("UNTRUSTED EXTERNAL CONTENT")).toBe(true);
    expect(doc).toContain("[truncated]");
  });
  test("new messages are asked for as the search plus an after window", async () => {
    calls = [];
    const mails = await newMessages(fresh("gmail.readonly").ctx, "from:billing", 1_700_000_000);
    const list = calls.find((c) => c.path === "/gmail/users/me/messages")!;
    const q = new URLSearchParams(list.query);
    expect(q.get("q")).toBe("from:billing after:1700000000");
    expect(q.get("maxResults")).toBe("25");
    expect(mails).toHaveLength(10);
    expect(mails[0]).toMatchObject({ id: "m1aaaaaa", from: "a@b.c" });
  });
  test("the Gmail poller fires nothing at first, then one event per mail keyed by its id", async () => {
    const poll = createRoutinePollers(async () => fresh("gmail.readonly").ctx).gmail;
    const first = await poll("u1", { query: "from:billing" }, null);
    expect(first.events).toEqual([]);
    const next = await poll("u1", { query: "from:billing" }, first.cursor);
    expect(next.events[0]).toMatchObject({
      key: "gmail:m1aaaaaa",
      event: { source: "gmail", from: "a@b.c" },
    });
    // A cursor from before a long gap is not trusted: nothing old fires.
    const afterGap = await poll("u1", { query: "from:billing" }, { at: Date.now() - 7_200_000 });
    expect(afterGap.events).toEqual([]);
  });
});

describe("google accounts", () => {
  const acct = (email: string, token: string, extra: Record<string, string> = {}) => ({
    email,
    refreshToken: token,
    accessToken: `acc-${token}`,
    expiresAt: String(now + 3_600_000),
    scopes: "gmail.readonly",
    ...extra,
  });
  const multi = (...list: Record<string, string>[]) =>
    mkCtx("u1", { accounts: JSON.stringify(list) });
  const finish = async (c: ReturnType<typeof mkCtx>, u: URL, email: string, token: string) => {
    userEmail = email;
    refreshReply = token;
    await plugin.callback!(
      c.ctx,
      new URLSearchParams({ code: "c1", state: u.searchParams.get("state")! }),
    );
  };
  const start = async (
    c: ReturnType<typeof mkCtx>,
    options: Record<string, unknown>,
    granted: string,
  ) => {
    const { authorizeUrl } = (await plugin.connect!(c.ctx, options)) as { authorizeUrl: string };
    const u = new URL(authorizeUrl);
    challenge = u.searchParams.get("code_challenge")!;
    scopeReply = granted;
    return u;
  };

  test("a legacy single-account config works as one account and migrates on the next write", async () => {
    const c = mkCtx("u1", {
      refreshToken: "ref-1",
      scopes: "gmail.readonly",
      email: "me@example.com",
      accessToken: "old",
      expiresAt: String(now + 30_000),
    });
    await tool("gmail_search").handler(c.ctx, { query: "x" });
    expect(accountsOf(c)).toMatchObject([
      {
        email: "me@example.com",
        refreshToken: "ref-1",
        accessToken: "acc-r1",
        scopes: "gmail.readonly",
      },
    ]);
    expect(c.get().refreshToken).toBeUndefined();
    expect(c.get().email).toBeUndefined();
  });
  test("connecting another account adds it and asks Google to show the account chooser", async () => {
    const c = multi(acct("me@example.com", "ra"));
    const u = await start(c, { scopes: ["gmail.readonly"] }, READ);
    expect(u.searchParams.get("prompt")).toBe("consent select_account");
    expect(u.searchParams.get("login_hint")).toBeNull();
    await finish(c, u, "Work@Example.com", "rb");
    expect(accountsOf(c).map((a) => a.email)).toEqual(["me@example.com", "work@example.com"]);
    expect(accountsOf(c)[0]!.refreshToken).toBe("ra");
    expect(accountsOf(c)[1]!.refreshToken).toBe("rb");
  });
  test("updating one account hints its email and changes only that account", async () => {
    const c = multi(acct("me@example.com", "ra"), acct("work@example.com", "rb"));
    const u = await start(
      c,
      { scopes: ["gmail.readonly", "gmail.compose"], account: "work@example.com" },
      `${READ} https://www.googleapis.com/auth/gmail.compose`,
    );
    expect(u.searchParams.get("login_hint")).toBe("work@example.com");
    await finish(c, u, "work@example.com", "rb2");
    expect(accountsOf(c)).toMatchObject([
      { email: "me@example.com", scopes: "gmail.readonly" },
      { email: "work@example.com", scopes: "gmail.readonly gmail.compose", refreshToken: "rb2" },
    ]);
  });
  test("a callback without an email is refused", async () => {
    const c = mkCtx();
    const u = await start(c, { scopes: ["gmail.readonly"] }, READ);
    userEmail = "";
    refreshReply = "ra";
    await expect(
      plugin.callback!(
        c.ctx,
        new URLSearchParams({ code: "c1", state: u.searchParams.get("state")! }),
      ),
    ).rejects.toMatchObject({ code: "NO_EMAIL" });
  });
  test("with several accounts a tool must name one; the named one is used", async () => {
    const c = multi(acct("me@example.com", "ra"), acct("work@example.com", "rb"));
    const err = await tool("gmail_search")
      .handler(c.ctx, { query: "x" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "ACCOUNT_REQUIRED" });
    expect(err.safe).toContain("me@example.com");
    expect(err.safe).toContain("work@example.com");
    await tool("gmail_search").handler(c.ctx, { query: "x", account: "Work@example.com" });
    expect(
      calls
        .filter((x) => x.path === "/gmail/users/me/messages")
        .every((x) => x.auth === "Bearer acc-rb"),
    ).toBe(true);
    await expect(
      tool("gmail_search").handler(c.ctx, { query: "x", account: "nobody@example.com" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ACCOUNT" });
  });
  test("with several accounts only those that have the permission are candidates", async () => {
    const c = multi(
      acct("me@example.com", "ra", { scopes: "drive.file" }),
      acct("work@example.com", "rb"),
    );
    await tool("gmail_search").handler(c.ctx, { query: "x" });
    expect(
      calls
        .filter((x) => x.path === "/gmail/users/me/messages")
        .every((x) => x.auth === "Bearer acc-rb"),
    ).toBe(true);
    await expect(
      tool("gmail_search").handler(c.ctx, { query: "x", account: "me@example.com" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
  });
  test("a revoked account needs auth alone; the other account keeps working", async () => {
    const c = multi(
      acct("me@example.com", "ra", { expiresAt: "0" }),
      acct("work@example.com", "rb"),
    );
    revokedRefresh.add("ra");
    await expect(
      tool("gmail_search").handler(c.ctx, { query: "x", account: "me@example.com" }),
    ).rejects.toMatchObject({ code: "NEEDS_AUTH" });
    expect(accountsOf(c).map((a) => [a.email, a.refreshToken])).toEqual([
      ["me@example.com", undefined],
      ["work@example.com", "rb"],
    ]);
    await tool("gmail_search").handler(c.ctx, { query: "x" }); // the only account that can still do it
    const st = await plugin.status!(c.ctx);
    expect(st.state).toBe("connected");
    expect(st.info).toMatchObject({
      accounts: [
        { email: "me@example.com", state: "needs-auth" },
        { email: "work@example.com", state: "connected", scopes: ["gmail.readonly"] },
      ],
    });
  });
  test("disconnecting one account revokes only it; without an account everything goes but the OAuth client", async () => {
    const c = multi(acct("me@example.com", "ra"), acct("work@example.com", "rb"));
    await plugin.disconnect!(c.ctx, { account: "me@example.com" });
    expect(calls.filter((x) => x.path === "/revoke").map((x) => x.body)).toEqual(["token=ra"]);
    expect(accountsOf(c).map((a) => a.email)).toEqual(["work@example.com"]);
    await expect(
      plugin.disconnect!(c.ctx, { account: "nobody@example.com" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ACCOUNT" });
    await plugin.disconnect!(c.ctx);
    expect(c.get()).toEqual(KEYS);
  });
  test("each account has its own send rate limit", async () => {
    const a = { to: ["a@b.co"], subject: "hi", body: "yo" };
    const c = multi(
      acct("me@example.com", "ra", { scopes: "gmail.send", allowSend: "true" }),
      acct("work@example.com", "rb", { scopes: "gmail.send", allowSend: "true" }),
    );
    for (let i = 0; i < 10; i++)
      await tool("gmail_send").handler(c.ctx, { ...a, account: "me@example.com" });
    await expect(
      tool("gmail_send").handler(c.ctx, { ...a, account: "me@example.com" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(
      await tool("gmail_send").handler(c.ctx, { ...a, account: "work@example.com" }),
    ).toMatchObject({ status: "sent" });
  });
  test("google_accounts lists emails and services, never tokens", async () => {
    const c = multi(
      acct("me@example.com", "ra", { scopes: "gmail.readonly drive.file spreadsheets" }),
      { email: "old@example.com" },
    );
    const out = JSON.stringify(await tool("google_accounts").handler(c.ctx, {}));
    expect(JSON.parse(out)).toEqual({
      accounts: [
        { email: "me@example.com", state: "connected", services: ["gmail", "drive", "sheets"] },
        { email: "old@example.com", state: "needs-auth", services: [] },
      ],
    });
    expect(out).not.toContain("acc-ra");
    expect(out).not.toContain('"ra"');
  });
});

describe("google docs and sheets", () => {
  const as = (scopes: string) =>
    mkCtx("u1", {
      accounts: JSON.stringify([
        {
          email: "me@example.com",
          refreshToken: "r",
          accessToken: "a",
          expiresAt: String(now + 3_600_000),
          scopes,
        },
      ]),
    }).ctx;
  const sent = (suffix: string) =>
    calls.find((x) => x.path.endsWith(suffix) || decodeURIComponent(x.path).endsWith(suffix))!;

  test("docs_read returns paragraph and table text inside the untrusted envelope", async () => {
    for (const scope of ["documents.readonly", "documents"]) {
      const out = (await tool("docs_read").handler(as(scope), { id: "doc12345" })) as string;
      expect(out.startsWith("UNTRUSTED EXTERNAL CONTENT")).toBe(true);
      expect(out).toContain("title: Plan");
      expect(out).toContain("Hello world\n");
      expect(out).toContain("a\tb");
    }
    expect(tool("docs_read").effect).toBe("read");
  });
  test("docs tools check the permission and the id before calling Google", async () => {
    await expect(
      tool("docs_read").handler(as("gmail.readonly"), { id: "doc12345" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("docs_create").handler(as("documents.readonly"), { title: "t" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("docs_append_text").handler(as("documents.readonly"), { id: "doc12345", text: "x" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("docs_read").handler(as("documents"), { id: "../etc/passwd" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(
      tool("docs_append_text").handler(as("documents"), { id: "doc12345", text: "  " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(calls.length).toBe(0);
  });
  test("a Google API that is off in the user's project says which one to enable, with Google's own library link", async () => {
    const err = await tool("docs_read")
      .handler(as("documents.readonly"), { id: "apioff123" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "API_NOT_ENABLED" });
    expect(err.safe).toContain("Google Docs API");
    expect(err.fix).toContain("https://console.cloud.google.com/apis/library/docs.googleapis.com");
    expect(err.fix).not.toContain("evil.example"); // links come from our table, never from Google's reply
    await expect(
      tool("docs_read").handler(as("documents.readonly"), { id: "nope12345" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  test("a permission that was never granted tells the user where to grant it", async () => {
    const err = await tool("sheets_read")
      .handler(as("gmail.readonly"), { id: "sheet12345" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "SCOPE_MISSING" });
    expect(err.safe).toContain("Sheets: read spreadsheets");
    expect(err.fix).toContain("Studio > Plugins > Google");
    expect(err.fix).toContain("Change permissions");
  });
  test("the setup guide links the API page of every service", () => {
    const guide = plugin.guide!().join("\n");
    for (const host of ["gmail", "calendar-json", "drive", "docs", "sheets"])
      expect(guide).toContain(
        `https://console.cloud.google.com/apis/library/${host}.googleapis.com`,
      );
  });
  test("docs_create makes the document and inserts the first text", async () => {
    const out = await tool("docs_create").handler(as("documents"), {
      title: "Notes",
      text: "First line",
    });
    expect(out).toEqual({
      status: "created",
      documentId: "newdoc123",
      link: "https://docs.google.com/document/d/newdoc123/edit",
    });
    expect(JSON.parse(sent("/docs/documents").body)).toEqual({ title: "Notes" });
    expect(JSON.parse(sent("newdoc123:batchUpdate").body)).toEqual({
      requests: [{ insertText: { text: "First line", location: { index: 1 } } }],
    });
  });
  test("docs_append_text adds text at the end of the document", async () => {
    expect(
      await tool("docs_append_text").handler(as("documents"), { id: "doc12345", text: "More" }),
    ).toEqual({ status: "appended", documentId: "doc12345" });
    expect(JSON.parse(sent("doc12345:batchUpdate").body)).toEqual({
      requests: [{ insertText: { text: "More", endOfSegmentLocation: {} } }],
    });
  });

  test("sheets_read lists the sheets, or returns the rows of a range", async () => {
    const meta = JSON.parse(
      (await tool("sheets_read").handler(as("spreadsheets.readonly"), {
        id: "sheet12345",
      })) as string,
    );
    expect(meta).toMatchObject({
      title: "Budget",
      sheets: [{ title: "Sheet1", rows: 100, columns: 6 }],
    });
    const rows = JSON.parse(
      (await tool("sheets_read").handler(as("spreadsheets"), {
        id: "sheet12345",
        range: "Sheet1!A1:B2",
      })) as string,
    );
    expect(rows).toMatchObject({
      range: "Sheet1!A1:B2",
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
    });
    expect(rows.notice).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(tool("sheets_read").effect).toBe("read");
  });
  test("sheets_read output is bounded and says how many rows the range had", async () => {
    const out = (await tool("sheets_read").handler(as("spreadsheets.readonly"), {
      id: "sheet12345",
      range: "Sheet1!A1:A1500",
    })) as string;
    const j = JSON.parse(out);
    expect(out.length).toBeLessThanOrEqual(7500);
    expect(j.rowsInRange).toBe(1500);
    expect(j.omitted).toBeGreaterThan(0);
    expect(j.rows.length + j.omitted).toBe(1000);
  });
  test("sheets_create returns the new id and link", async () => {
    expect(await tool("sheets_create").handler(as("spreadsheets"), { title: "Budget" })).toEqual({
      status: "created",
      spreadsheetId: "newsheet1",
      link: "https://docs.google.com/spreadsheets/d/newsheet1/edit",
    });
    expect(JSON.parse(sent("/sheets/spreadsheets").body)).toEqual({
      properties: { title: "Budget" },
    });
  });
  test("sheets writes store values as typed (RAW), so a formula text is never evaluated", async () => {
    const values = [
      ['=IMPORTXML("https://evil.example/","//a")', 2],
      [true, null],
    ];
    expect(
      await tool("sheets_update_range").handler(as("spreadsheets"), {
        id: "sheet12345",
        range: "Sheet1!A1:B2",
        values,
      }),
    ).toEqual({ status: "updated", updatedRange: "Sheet1!A1:B2", updatedCells: 4 });
    const put = calls.find((x) => x.method === "PUT")!;
    expect(put.query).toBe("?valueInputOption=RAW");
    expect(JSON.parse(put.body)).toEqual({
      range: "Sheet1!A1:B2",
      majorDimension: "ROWS",
      values: [
        ['=IMPORTXML("https://evil.example/","//a")', 2],
        [true, ""],
      ],
    });
    expect(
      await tool("sheets_append_rows").handler(as("spreadsheets"), {
        id: "sheet12345",
        range: "Sheet1",
        values: [["x", 1]],
      }),
    ).toEqual({ status: "appended", updatedRange: "Sheet1!A3:B3", updatedRows: 1 });
    expect(sent("values/Sheet1:append").query).toBe(
      "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    );
  });
  test("sheets tools reject a read-only permission, a bad id or range, and bad values before calling Google", async () => {
    const ok = { id: "sheet12345", range: "Sheet1!A1:B2", values: [["a"]] };
    await expect(
      tool("sheets_update_range").handler(as("spreadsheets.readonly"), ok),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(
      tool("sheets_read").handler(as("gmail.readonly"), { id: "sheet12345" }),
    ).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    for (const range of ["Sheet1!A1:B2/../x", "A1?x=1", "Sheet1!A1:B2;", "'a!b'!A1", ""])
      await expect(
        tool("sheets_update_range").handler(as("spreadsheets"), { ...ok, range }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(
      tool("sheets_read").handler(as("spreadsheets"), { id: "bad id", range: "A1" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    for (const values of [
      [],
      "x",
      [["a", { nested: 1 }]],
      [[Number.NaN]],
      [["x".repeat(2001)]],
      Array.from({ length: 501 }, () => ["a"]),
    ])
      await expect(
        tool("sheets_append_rows").handler(as("spreadsheets"), { ...ok, values }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(calls.length).toBe(0);
  });
});

describe("stripHtml", () => {
  test("&amp; is decoded last, so an escaped entity stays text", () => {
    expect(stripHtml("<p>a &amp;lt;b&amp;gt; c</p>")).toBe("a &lt;b&gt; c");
    expect(stripHtml("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
  });
  test("tags are dropped before entities are decoded, so decoded angle brackets stay text", () => {
    expect(stripHtml("<p>1 &lt; 2 &gt; 0</p>")).toBe("1 < 2 > 0");
    expect(stripHtml("&lt;script&gt;x&lt;/script&gt;<b>hi</b>&nbsp;there")).toBe(
      "<script>x</script> hi there",
    );
    expect(stripHtml("<style>p{}</style><script>alert(1)</script>ok")).toBe("ok");
  });
});
