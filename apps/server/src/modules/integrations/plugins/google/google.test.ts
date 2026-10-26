import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getPlugin, type PluginContext } from "../registry";
import { configureGoogleForTests, redirectUri } from "./oauth";
import "./index";

let calls: { path: string; auth?: string; body: string }[] = [];
let tokenCount = 0, tokenMode: "ok" | "revoked" = "ok", expiresIn = 3600, scopeReply = "";
let challenge = "";
const big = "x".repeat(20_000);
const fake = Bun.serve({ port: 0, async fetch(req) {
  const u = new URL(req.url); const body = await req.text(); calls.push({ path: u.pathname, auth: req.headers.get("authorization") ?? undefined, body });
  const json = (o: unknown, status = 200) => Response.json(o, { status });
  if (u.pathname === "/token") {
    const f = new URLSearchParams(body);
    if (f.get("grant_type") === "authorization_code") {
      const ok = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === challenge;
      return ok ? json({ access_token: "acc-1", refresh_token: "ref-1", expires_in: expiresIn, scope: scopeReply }) : json({ error: "invalid_grant" }, 400);
    }
    tokenCount++; await Bun.sleep(20);
    return tokenMode === "revoked" ? json({ error: "invalid_grant" }, 400) : json({ access_token: `acc-r${tokenCount}`, expires_in: 3600 });
  }
  if (u.pathname === "/revoke") return json({});
  if (u.pathname === "/userinfo") return json({ email: "me@example.com" });
  if (u.pathname === "/gmail/users/me/messages") return json({ messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}aaaaaa` })) });
  if (u.pathname.startsWith("/gmail/users/me/messages/") && u.pathname.endsWith("/send")) return json({ id: "sent1" });
  if (u.pathname.startsWith("/gmail/users/me/messages/")) return json({ id: "m1aaaaaa", snippet: big, payload: { mimeType: "text/plain", body: { data: Buffer.from(big).toString("base64url") }, headers: [{ name: "Subject", value: "S".repeat(900) }, { name: "From", value: "a@b.c" }] } });
  if (u.pathname === "/gmail/users/me/drafts") return json({ id: "d1" });
  return json({}, 404);
} });
const base = `http://localhost:${fake.port}`;
afterAll(() => { fake.stop(true); configureGoogleForTests({}); });

const KEYS = { clientId: "cid", clientSecret: "csecret" };
function mkCtx(userId = "u1", start: Record<string, string> = {}) {
  let config: Record<string, string> = { ...KEYS, ...start };
  const ctx: PluginContext = { userId, get config() { return config; }, async setConfig(n) { config = { ...n }; } };
  return { ctx, get: () => config };
}
const plugin = getPlugin("google")!;
const tool = (n: string) => plugin.tools!.find((t) => t.name === n)!;
let now = 1_000_000;
beforeEach(() => {
  calls = []; tokenCount = 0; tokenMode = "ok"; expiresIn = 3600; now = 1_000_000;
  process.env.GOOGLE_OAUTH_REDIRECT_BASE = "https://zetta.test";
  configureGoogleForTests({ authUrl: `${base}/auth`, tokenUrl: `${base}/token`, revokeUrl: `${base}/revoke`, userinfoUrl: `${base}/userinfo`, gmailBase: `${base}/gmail`, calendarBase: `${base}/cal`, driveBase: `${base}/drive`, now: () => now });
});

const READ = "https://www.googleapis.com/auth/gmail.readonly";
async function connect(c: ReturnType<typeof mkCtx>, scopes: string[], granted: string, allowSend = false) {
  const { authorizeUrl } = (await plugin.connect!(c.ctx, { scopes, allowSend })) as { authorizeUrl: string };
  const u = new URL(authorizeUrl); challenge = u.searchParams.get("code_challenge")!; scopeReply = granted;
  return u;
}

describe("google oauth", () => {
  test("not configured gives setup instructions", async () => {
    const none = () => mkCtx("u1", { clientId: "", clientSecret: "" }).ctx;
    await expect(plugin.connect!(none(), { scopes: ["gmail.readonly"] })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect((await plugin.status!(none())).state).toBe("error");
  });
  test("authorize URL carries PKCE, state, offline access and incremental scopes; nothing leaks into config view", async () => {
    const c = mkCtx(); const u = await connect(c, ["gmail.readonly"], READ);
    const q = u.searchParams;
    expect(q.get("code_challenge_method")).toBe("S256"); expect(q.get("access_type")).toBe("offline"); expect(q.get("prompt")).toBe("consent"); expect(q.get("include_granted_scopes")).toBe("true");
    expect(q.get("redirect_uri")).toBe(redirectUri()); expect(q.get("redirect_uri")).toBe("https://zetta.test/api/plugins/google/callback");
    expect(q.get("scope")).toBe(`openid email ${READ}`); expect(q.get("client_secret")).toBeNull();
    expect(c.get().pending).not.toContain(q.get("state")!); // only the hash of state is stored
  });
  test("rejects unknown scope and allowSend without send scope", async () => {
    await expect(plugin.connect!(mkCtx().ctx, { scopes: ["gmail.all"] })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    await expect(plugin.connect!(mkCtx().ctx, { scopes: ["gmail.readonly"], allowSend: true })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  });
  test("callback: bad state rejected without consuming, good state works once, replay rejected", async () => {
    const c = mkCtx(); const u = await connect(c, ["gmail.readonly"], READ);
    await expect(plugin.callback!(c.ctx, new URLSearchParams({ code: "x", state: "forged" }))).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(c.get().pending).toBeDefined();
    const ok = new URLSearchParams({ code: "c1", state: u.searchParams.get("state")! });
    await plugin.callback!(c.ctx, ok);
    expect(c.get()).toMatchObject({ refreshToken: "ref-1", email: "me@example.com", scopes: "gmail.readonly" }); expect(c.get().pending).toBeUndefined();
    await expect(plugin.callback!(c.ctx, ok)).rejects.toMatchObject({ code: "INVALID_STATE" });
    // another user never has the pending flow
    await expect(plugin.callback!(mkCtx("u2").ctx, ok)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  test("callback: wrong PKCE verifier at Google fails; expiry and denial consume the state", async () => {
    const c = mkCtx(); const u = await connect(c, ["gmail.readonly"], READ); challenge = "other";
    await expect(plugin.callback!(c.ctx, new URLSearchParams({ code: "c", state: u.searchParams.get("state")! }))).rejects.toMatchObject({ code: "EXCHANGE_FAILED" });
    const d = mkCtx(); const u2 = await connect(d, ["gmail.readonly"], READ); now += 11 * 60_000;
    await expect(plugin.callback!(d.ctx, new URLSearchParams({ code: "c", state: u2.searchParams.get("state")! }))).rejects.toMatchObject({ code: "STATE_EXPIRED" });
    expect(d.get().pending).toBeUndefined();
    const e = mkCtx(); const u3 = await connect(e, ["gmail.readonly"], READ);
    await expect(plugin.callback!(e.ctx, new URLSearchParams({ error: "access_denied", state: u3.searchParams.get("state")! }))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  test("refresh is single-flight, skewed, and persisted", async () => {
    const c = mkCtx("u1", { refreshToken: "ref-1", scopes: "gmail.readonly", accessToken: "old", expiresAt: String(now + 30_000) }); // inside the 60s skew
    await Promise.all([1, 2, 3, 4].map(() => tool("gmail_read_message").handler(c.ctx, { id: "m1aaaaaa" })));
    expect(tokenCount).toBe(1); expect(c.get().accessToken).toBe("acc-r1");
    expect(calls.filter((x) => x.path.includes("/messages/")).every((x) => x.auth === "Bearer acc-r1")).toBe(true);
    await tool("gmail_read_message").handler(c.ctx, { id: "m1aaaaaa" }); expect(tokenCount).toBe(1); // cached while fresh
  });
  test("revoked refresh token clears credentials and reports needs-auth", async () => {
    const c = mkCtx("u1", { refreshToken: "ref-1", scopes: "gmail.readonly", email: "me@example.com" }); tokenMode = "revoked";
    await expect(tool("gmail_search").handler(c.ctx, { query: "x" })).rejects.toMatchObject({ code: "NEEDS_AUTH" });
    expect(c.get().refreshToken).toBeUndefined(); expect((await plugin.status!(c.ctx)).state).toBe("needs-auth");
  });
  test("disconnect revokes at Google and wipes the tokens but keeps the OAuth client", async () => {
    const c = mkCtx("u1", { refreshToken: "ref-1" }); await plugin.disconnect!(c.ctx);
    expect(calls.some((x) => x.path === "/revoke" && x.body === "token=ref-1")).toBe(true); expect(c.get()).toEqual(KEYS);
  });
});

describe("google tools", () => {
  const fresh = (scopes: string, extra: Record<string, string> = {}) => mkCtx("u1", { refreshToken: "r", accessToken: "a", expiresAt: String(now + 3_600_000), scopes, ...extra });
  test("scope gating", async () => {
    await expect(tool("gmail_search").handler(fresh("drive.file").ctx, { query: "x" })).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(tool("gmail_create_draft").handler(fresh("gmail.readonly").ctx, { to: ["a@b.co"], subject: "s", body: "b" })).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(tool("calendar_create_event").handler(fresh("calendar.events.readonly").ctx, { title: "t", start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" })).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(tool("drive_search").handler(fresh("gmail.readonly").ctx, { query: "x" })).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    expect(calls.length).toBe(0);
  });
  test("send needs scope AND allowSend, validates recipients, and is rate limited", async () => {
    const args = { to: ["a@b.co"], subject: "hi", body: "yo" };
    await expect(tool("gmail_send").handler(fresh("gmail.readonly", { allowSend: "true" }).ctx, args)).rejects.toMatchObject({ code: "SCOPE_MISSING" });
    await expect(tool("gmail_send").handler(fresh("gmail.send").ctx, args)).rejects.toMatchObject({ code: "SEND_DISABLED" });
    await expect(tool("gmail_send").handler(fresh("gmail.send", { allowSend: "true" }).ctx, { ...args, to: ["a@b.co\r\nBcc: x@y.z"] })).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(calls.length).toBe(0);
    const ok = fresh("gmail.send", { allowSend: "true" }); const out = await tool("gmail_send").handler(ok.ctx, args) as { status: string };
    expect(out.status).toBe("sent");
    for (let i = 0; i < 9; i++) await tool("gmail_send").handler(ok.ctx, args);
    await expect(tool("gmail_send").handler(ok.ctx, args)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  test("draft rejects header injection in subject", async () => {
    await expect(tool("gmail_create_draft").handler(fresh("gmail.compose").ctx, { to: ["a@b.co"], subject: "x\nBcc: e@e.ee", body: "b" })).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(await tool("gmail_create_draft").handler(fresh("gmail.compose").ctx, { to: ["a@b.co"], subject: "ok", body: "b" })).toMatchObject({ status: "draft_created" });
  });
  test("outputs are bounded and marked untrusted", async () => {
    const list = await tool("gmail_search").handler(fresh("gmail.readonly").ctx, { query: "x", max: 50 }) as string;
    expect(list.length).toBeLessThanOrEqual(7500); expect(list).toContain("UNTRUSTED EXTERNAL CONTENT"); expect(JSON.parse(list).messages[0].subject.length).toBeLessThan(200);
    const doc = await tool("gmail_read_message").handler(fresh("gmail.readonly").ctx, { id: "m1aaaaaa" }) as string;
    expect(doc.length).toBeLessThanOrEqual(7500); expect(doc.startsWith("UNTRUSTED EXTERNAL CONTENT")).toBe(true); expect(doc).toContain("[truncated]");
  });
});
