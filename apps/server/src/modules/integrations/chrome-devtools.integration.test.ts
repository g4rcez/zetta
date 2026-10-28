import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createMcp } from "./mcp";
import { createSources } from "./sources";
import { createFeaturesService } from "../features/service";

/**
 * Real Chrome DevTools MCP server (`chrome-devtools-mcp`, stdio via npx) driven through Zetta's MCP layer:
 * allowlisted command -> user-owned server -> per-bot binding -> a bot's `zetta:mcp` tool call -> real headless Chrome.
 * Opt-in (downloads the package on first run and starts Chrome): ZETTA_MCP_CHROME_TEST=1.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url && process.env.ZETTA_MCP_CHROME_TEST === "1" ? describe : describe.skip;
const id = `mcpc-${uuidv7()}`;
const NPX = Bun.which("npx") ?? "npx";

suite("chrome-devtools MCP through Zetta", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession() { return { user: { id } }; } } }, async () => ({ isAdmin: false }));
  const server = Bun.serve({ port: 0, fetch: () => new Response("<html><head><title>Zetta MCP Test Page</title></head><body><h1 id=h>Hello DevTools</h1><button id=b onclick=\"document.getElementById('h').textContent='Clicked!'\">Press</button></body></html>", { headers: { "content-type": "text/html" } }) });
  const mcp = createMcp(db, undefined, { callMs: 120_000, allowPrivate: true, stdioAllowlist: [{ command: NPX, args: ["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"] }] });
  const script: string[] = []; const prompts: string[] = [];
  const run = Object.assign(async (t: { prompt: string }) => { prompts.push(t.prompt); return { text: script.shift() ?? "done", stopped: false }; }, { stream: async function* (t: { prompt: string }) { prompts.push(t.prompt); yield script.shift() ?? "done"; } });
  const features = createFeaturesService(db, run as never);
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db, run as never, undefined, undefined, undefined, undefined, undefined, mcp) }, features: { access, features }, integrations: { access, mcp, sources: createSources(db) }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(membership).values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    server.stop(true);
    await db.$client.query("delete from bot_integration where owner_user_id = $1", [id]);
    await db.$client.query("delete from mcp_server where owner_user_id = $1", [id]);
    await cleanupTestUsers(db, [id]);
  });

  test("lists DevTools tools, then a bot opens a page and reads it through the MCP tool loop", async () => {
    const srv = (await call("POST", "/api/mcp/servers", { name: "devtools", transport: "stdio", command: NPX, args: ["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"] })).json.server.id as string;
    const tools = (await call("GET", `/api/mcp/servers/${srv}/tools`)).json.tools.map((t: { name: string }) => t.name);
    for (const t of ["navigate_page", "take_snapshot", "take_screenshot", "evaluate_script", "click", "list_pages"]) expect(tools).toContain(t);

    const bot = (await call("POST", "/api/bots", { name: "Inspector" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    await call("PUT", `/api/bots/${bot}/integrations/${srv}`);
    const conv = (await call("POST", "/api/conversations", { botId: bot })).json.conversation.id;
    const pageUrl = `http://localhost:${server.port}/`;
    const tool = (name: string, args: object) => "```zetta:mcp\n" + JSON.stringify({ server: "devtools", tool: name, args }) + "\n```";
    script.push(tool("new_page", { url: pageUrl }), tool("take_snapshot", { pageId: 1 }), "The page title is shown above.");
    prompts.length = 0;
    const r = await call("POST", `/api/conversations/${conv}/messages`, { content: "Open the test page and tell me its title" });
    expect(r.status).toBe(201);
    expect(prompts.some((p) => p.includes("Tool results") && p.includes("Zetta MCP Test Page"))).toBe(true);
    expect(r.json.assistant.content).toContain("The page title is shown above.");
  }, 240_000);

  test("allowlisted commands cannot be given other arguments", async () => {
    expect((await call("POST", "/api/mcp/servers", { name: "sneaky", transport: "stdio", command: NPX, args: ["-y", "some-other-package"] })).status).toBe(400);
  });

  test("a command that is not allowlisted is refused", async () => {
    expect((await call("POST", "/api/mcp/servers", { name: "evil", transport: "stdio", command: "/bin/sh", args: ["-c", "echo hi"] })).status).toBe(400);
  });
});
