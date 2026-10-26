import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createConnectionsService } from "../connections/service";
import { createConnectionStore } from "../connections/store";
import { createIdentityAccess } from "../identity/access";
import { createMcp } from "../integrations/mcp";
import { configureVault } from "../integrations/plugins/vault";
import { createChatService } from "./service";

/**
 * zetta:credential end to end: a bot signs in with a login the user shared from 1Password (fake `op` CLI) without the value ever reaching
 * the model, the reply, the stored messages or the audit log; wrong sites and wrong inputs get nothing.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url?.endsWith("/zetta_test") ? describe : describe.skip; // initializes a key check: only ever against the dedicated test database
const ids = [`cred-a-${crypto.randomUUID()}`, `cred-b-${crypto.randomUUID()}`];
const [A, B] = ids as [string, string];
const KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "hunter2-very-secret", TOKEN = "ops_service_account_token";

suite("credential fills against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  let script: string[] = []; const prompts: string[] = [];
  const fakeRun = Object.assign(async (t: { prompt: string }) => { prompts.push(t.prompt); return { text: script.shift() ?? "done", stopped: false }; },
    { stream: async function* (t: { prompt: string }) { prompts.push(t.prompt); yield script.shift() ?? "done"; } });
  const typed: string[] = []; const page = { url: "https://github.com/login", focused: { tag: "input", type: "password", autocomplete: "current-password", name: "password", inputmode: "" } as unknown };
  const fakeComputer = {
    epochOf: () => 0, start: async () => ({}), text: async () => "Sign in to GitHub", focus: async () => ({ ...page }),
    act: async (_u: string, _p: string, _by: string, a: { type: string; text?: string }) => { if (a.type === "type") typed.push(a.text!); return { url: page.url, loginRequired: a.type === "open" }; },
  };
  let app: ReturnType<typeof createApp>; let mcp: ReturnType<typeof createMcp>;
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, text: await r.clone().text(), json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const store = await createConnectionStore(db, { configuration: { key: KEY, keyId: "v1" }, allowedProviders: ["plugin"], initializeEmpty: true });
    const connections = createConnectionsService(db, store);
    mcp = createMcp(db, connections, { allowPrivate: false });
    configureVault({ exec: async (argv) => {
      if (argv[2] === "list" && argv[1] === "item") return { code: 0, stderr: "", stdout: JSON.stringify([{ id: "itm1", title: "GitHub", category: "LOGIN", vault: { id: "vlt1" }, urls: [{ href: "https://github.com" }] }]) };
      if (argv[2] === "get") return { code: 0, stderr: "", stdout: JSON.stringify({ fields: [{ purpose: "USERNAME", value: "octocat" }, { purpose: "PASSWORD", value: PASSWORD }] }) };
      return { code: 0, stderr: "", stdout: "[]" };
    } });
    const chat = createChatService(db, fakeRun as never, undefined, fakeComputer as never, undefined, connections, undefined, mcp);
    app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => {
    for (const t of ["bot_integration", "mcp_server", "connection_credential", "connection_mutation_receipt"]) await db.$client.query(`delete from ${t} where owner_user_id = any($1)`, [ids]);
    await db.$client.query("delete from connection where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids); // connection_nonce is an append-only ledger checked against the key check: never delete from it
  });

  test("a shared login is typed into the right input on the right site; the value never reaches the bot or the chat", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Signer" })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true, computer_mode = 'browser' where id = $1", [bot.id]);
    const c = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json.conversation.id as string;
    const say = (content: string) => call(A, "POST", `/api/conversations/${c}/messages`, { content });
    const a = await access.requireActive(new Headers({ "x-test-user": A }));
    await mcp.plugins.install(a, "1password", { serviceAccountToken: TOKEN }, [bot.id]);
    await mcp.plugins.connect(a, "1password", { grant: { id: "vlt1/itm1" } });

    // the sign-in page no longer forces a handoff: the bot is told which shared login fits this site
    prompts.length = 0; script = ['```zetta:browser\n{"action":"open","url":"https://github.com/login"}\n```', "ok"];
    await say("sign in to github");
    expect(prompts.some((p) => p.includes("ref 1password:vlt1/itm1"))).toBe(true);
    expect((await db.$client.query("select 1 from attention_item where owner_user_id = $1", [A])).rows).toHaveLength(0);

    prompts.length = 0; typed.length = 0;
    script = ['```zetta:credential\n{"ref":"1password:vlt1/itm1","field":"password"}\n```', "Signed in."];
    const r = await say("fill the password");
    expect(typed).toEqual([PASSWORD]);
    expect(prompts.some((p) => p.includes('filled the password for "GitHub"'))).toBe(true);
    expect(r.text).toContain("Filled the password for GitHub");
    for (const p of prompts) expect(p).not.toContain(PASSWORD);
    expect(r.text).not.toContain(PASSWORD);
    const stored = await db.$client.query("select content from message where owner_user_id = $1", [A]);
    expect(JSON.stringify(stored.rows)).not.toContain(PASSWORD);
    const audit = await db.$client.query("select detail, outcome from audit_event where owner_user_id = $1 and detail like 'credential%'", [A]);
    expect(audit.rows).toContainEqual({ detail: "credential:password", outcome: "ok" });
    expect(JSON.stringify(audit.rows)).not.toContain(PASSWORD);

    // a lookalike site, a comment box, an ungranted field: nothing is typed and the user sees why
    typed.length = 0;
    page.url = "https://github.com.evil.example/login";
    script = ['```zetta:credential\n{"ref":"1password:vlt1/itm1","field":"password"}\n```'];
    expect((await say("again")).text).toContain("only filled on github.com");
    page.url = "https://github.com/login"; page.focused = { tag: "textarea", type: "", autocomplete: "", name: "comment", inputmode: "" };
    script = ['```zetta:credential\n{"ref":"1password:vlt1/itm1","field":"password"}\n```'];
    expect((await say("again")).text).toContain("does not look like a password box");
    page.focused = { tag: "input", type: "text", autocomplete: "one-time-code", name: "otp", inputmode: "numeric" };
    script = ['```zetta:credential\n{"ref":"1password:vlt1/itm1","field":"totp"}\n```'];
    expect((await say("again")).text).toContain("may not fill the totp");
    expect(typed).toEqual([]);

    // another user cannot use A's password manager, even naming the same ref
    const theirs = (await call(B, "POST", "/api/bots", { name: "Thief" })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true, computer_mode = 'browser' where id = $1", [theirs.id]);
    const c2 = (await call(B, "POST", "/api/conversations", { botId: theirs.id })).json.conversation.id as string;
    page.focused = { tag: "input", type: "password", autocomplete: "", name: "password", inputmode: "" };
    script = ['```zetta:credential\n{"ref":"1password:vlt1/itm1","field":"password"}\n```'];
    expect((await call(B, "POST", `/api/conversations/${c2}/messages`, { content: "steal" })).text).toContain("not connected to this bot");
    expect(typed).toEqual([]);
  });
});
