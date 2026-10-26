import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { z } from "zod";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createMcp } from "./mcp";
import { createSources, parseFeed } from "./sources";
import { createFeaturesService } from "../features/service";

void Client;
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`int-a-${crypto.randomUUID()}`, `int-b-${crypto.randomUUID()}`];
const [A, B] = ids as [string, string];

describe("parseFeed", () => {
  test("reads RSS and Atom, strips markup and bounds output", () => {
    const rss = `<rss><channel><item><title><![CDATA[Hello <b>World</b>]]></title><link>https://x.test/1</link><description>First &amp; best</description></item><item><title>Two</title><link>https://x.test/2</link></item></channel></rss>`;
    expect(parseFeed(rss)).toEqual([{ title: "Hello World", link: "https://x.test/1", summary: "First & best" }, { title: "Two", link: "https://x.test/2", summary: "" }]);
    const atom = `<feed><entry><title>A1</title><link href="https://y.test/a"/><summary>sum</summary></entry></feed>`;
    expect(parseFeed(atom)[0]).toMatchObject({ title: "A1", link: "https://y.test/a", summary: "sum" });
    expect(parseFeed("<rss>" + "<item><title>t</title></item>".repeat(50) + "</rss>", 10)).toHaveLength(10);
  });
});

suite("MCP integrations and sources against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  let opened = 0, closed = 0, slow = false;
  // A real MCP server (official SDK) behind an in-memory transport; sessions are counted to prove they are always closed.
  const connect = async () => {
    const server = new McpServer({ name: "fake", version: "1" });
    server.tool("echo", "echoes text", { text: z.string() }, async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }));
    server.tool("slow", "never answers in time", {}, async () => { await Bun.sleep(slow ? 60_000 : 1); return { content: [{ type: "text", text: "late" }] }; });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide); opened++;
    const close = clientSide.close.bind(clientSide); let done = false; clientSide.close = async () => { if (!done) { done = true; closed++; } await close(); };
    return clientSide;
  };
  const mcp = createMcp(db, undefined, { callMs: 400, allowPrivate: true, stdioAllowlist: [{ command: "/usr/bin/true", args: [] }], connect });
  const scripted: string[] = [];
  const prompts: string[] = [];
  const run = Object.assign(async (t: { prompt: string }) => { prompts.push(t.prompt); return { text: scripted.shift() ?? "x", stopped: false }; }, { stream: async function* (t: { prompt: string }) { prompts.push(t.prompt); yield scripted.shift() ?? "done"; } });
  const features = createFeaturesService(db, run as never, undefined, undefined, createSources(db, undefined, { allowPrivate: true, fetcher: async (u) => (u.includes("bad") ? Promise.reject(new Error("down")) : `<rss><item><title>Item from ${u}</title><link>${u}/1</link></item></rss>`) }) as never);
  const sources = createSources(db, undefined, { allowPrivate: true, fetcher: async (u) => (u.includes("bad") ? Promise.reject(new Error("down")) : `<rss><item><title>Item from ${u}</title><link>${u}/1</link></item></rss>`) });
  const chat = createChatService(db, run as never, undefined, undefined, undefined, undefined, undefined, mcp);
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat }, features: { access, features }, integrations: { access, mcp, sources }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => {
    await db.$client.query("delete from bot_integration where owner_user_id = any($1)", [ids]);
    await db.$client.query("delete from mcp_server where owner_user_id = any($1)", [ids]);
    await db.$client.query("delete from source where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids);
  });

  test("servers are per user; tools only through a per-user binding; sessions are always closed; stdio needs the allowlist", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Tooly" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true, visibility = 'team' where id = $1", [bot]);
    const srv = (await call(A, "POST", "/api/mcp/servers", { name: "files", transport: "http", url: "https://mcp.example.test/mcp" })).json.server.id as string;
    expect((await call(A, "POST", "/api/mcp/servers", { name: "evil", transport: "stdio", command: "/bin/rm", args: ["-rf", "/"] })).status).toBe(400); // not allowlisted
    expect((await call(A, "POST", "/api/mcp/servers", { name: "ok", transport: "stdio", command: "/usr/bin/true" })).status).toBe(201);
    expect((await call(A, "POST", "/api/mcp/servers", { name: "ok2", transport: "stdio", command: "/usr/bin/true", args: ["-e", "evil"] })).status).toBe(400); // an allowlisted command with extra arguments is a different program
    expect((await call(B, "GET", "/api/mcp/servers")).json.servers).toHaveLength(0);
    expect((await call(B, "GET", `/api/mcp/servers/${srv}/tools`)).status).toBe(404);
    expect((await call(B, "PUT", `/api/bots/${bot}/integrations/${srv}`)).status).toBe(404); // B cannot bind A's server
    const tools = (await call(A, "GET", `/api/mcp/servers/${srv}/tools`)).json.tools.map((t: { name: string }) => t.name).sort();
    expect(tools).toEqual(["echo", "slow"]); expect(opened).toBe(closed);
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    const say = (t: string) => call(A, "POST", `/api/conversations/${conv}/messages`, { content: t });
    // unbound -> the tool is refused and the bot is told
    scripted.push('```zetta:mcp\n{"server":"files","tool":"echo","args":{"text":"hi"}}\n```', "gave up");
    expect((await say("use files")).json.assistant.content).toContain("could not be used");
    expect((await call(A, "PUT", `/api/bots/${bot}/integrations/${srv}`)).status).toBe(200);
    prompts.length = 0;
    scripted.push('```zetta:mcp\n{"server":"files","tool":"echo","args":{"text":"hi"}}\n```', "The tool said echo:hi");
    const r = await say("use files again");
    expect(r.json.assistant.content).toContain("The tool said echo:hi");
    expect(prompts.some((p) => p.includes("Tool results") && p.includes("echo:hi"))).toBe(true);
    expect(opened).toBe(closed); // every session was closed
    // B chatting with A's (team) bot has no binding of their own -> cannot use A's server
    const cb = (await call(B, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    scripted.push('```zetta:mcp\n{"server":"files","tool":"echo","args":{"text":"x"}}\n```', "nope");
    expect((await call(B, "POST", `/api/conversations/${cb}/messages`, { content: "try" })).json.assistant.content).toContain("could not be used");
    // deleting the server removes bindings
    expect((await call(A, "DELETE", `/api/mcp/servers/${srv}`)).status).toBe(200);
    expect((await call(A, "GET", `/api/bots/${bot}/integrations`)).json.servers).toHaveLength(0);
  });

  test("a hung server times out and its session is still closed", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Patient" })).json.bot.id as string;
    const srv = (await call(A, "POST", "/api/mcp/servers", { name: "slowpoke", transport: "http", url: "https://mcp2.example.test/mcp" })).json.server.id as string;
    await call(A, "PUT", `/api/bots/${bot}/integrations/${srv}`);
    const before = { o: opened, c: closed }; slow = true;
    const t0 = Date.now();
    const res = await mcp.callTool({ userId: A, isAdmin: false } as never, bot, "slowpoke", "slow", {}).then(() => "ok", (e) => (e as { code: string }).code);
    slow = false;
    expect(res).toBe("TIMEOUT"); expect(Date.now() - t0).toBeLessThan(3_000);
    expect(opened - before.o).toBe(closed - before.c);
  }, 40_000);

  test("sources: private addresses are blocked, briefings report gaps instead of inventing content, owner-scoped", async () => {
    const strict = createSources(db, undefined, {});
    expect(await strict.add({ userId: A, isAdmin: false } as never, { kind: "rss", url: "http://localhost:3000/feed", label: "local" }).then(() => "ok", (e) => e.code)).toBe("BLOCKED");
    const good = (await call(A, "POST", "/api/sources", { kind: "rss", url: "https://blog.example.test/feed", label: "Blog" })).json.source.id;
    await call(A, "POST", "/api/sources", { kind: "rss", url: "https://bad.example.test/feed", label: "Broken" });
    expect((await call(B, "GET", "/api/sources")).json.sources).toHaveLength(0);
    const b = (await call(A, "POST", "/api/sources/briefing", {})).json;
    expect(b.gaps).toEqual(["Broken"]); expect(b.prompt).toContain("Item from https://blog.example.test/feed"); expect(b.prompt).toContain("## Broken\n(could not be read)");
    expect((await call(B, "DELETE", `/api/sources/${good}`)).status).toBe(404);
  });

  test("a workflow can feed followed sources to a bot (source -> briefing flow)", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Briefer2" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    const wf = (await call(A, "POST", "/api/workflows", { name: "briefing", graph: { start: "s", nodes: { s: { type: "sources", next: "p" }, p: { type: "prompt", botId: bot, template: "Summarize:\n{{prev}}", next: "e" }, e: { type: "end" } } } })).json.workflow;
    prompts.length = 0;
    const r = await call(A, "POST", `/api/workflows/${wf.id}/run`, { input: "" });
    expect(r.json.run.status).toBe("succeeded");
    expect(prompts.at(-1)).toContain("Item from https://blog.example.test/feed"); expect(prompts.at(-1)).toContain("could not be read");
  });
});
