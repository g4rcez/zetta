import { uuidv7 } from "@zetta/core/uuid";
import { connection } from "@zetta/db/schema/connections";
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
import { sealedFor } from "../../test-support/sealed";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createMcp } from "./mcp";
import { createSources, parseFeed } from "./sources";
import { createFeaturesService } from "../features/service";

void Client;
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`int-a-${uuidv7()}`, `int-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

describe("parseFeed", () => {
  test("reads RSS and Atom, strips markup and bounds output", () => {
    const rss = `<rss><channel><item><title><![CDATA[Hello <b>World</b>]]></title><link>https://x.test/1</link><description>First &amp; best</description></item><item><title>Two</title><link>https://x.test/2</link></item></channel></rss>`;
    expect(parseFeed(rss)).toEqual([
      { title: "Hello World", link: "https://x.test/1", summary: "First & best" },
      { title: "Two", link: "https://x.test/2", summary: "" },
    ]);
    const atom = `<feed><entry><title>A1</title><link href="https://y.test/a"/><summary>sum</summary></entry></feed>`;
    expect(parseFeed(atom)[0]).toMatchObject({
      title: "A1",
      link: "https://y.test/a",
      summary: "sum",
    });
    expect(
      parseFeed("<rss>" + "<item><title>t</title></item>".repeat(50) + "</rss>", 10),
    ).toHaveLength(10);
  });
});

suite("MCP integrations and sources against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  let opened = 0,
    closed = 0,
    slow = false;
  // A real MCP server (official SDK) behind an in-memory transport; sessions are counted to prove they are always closed.
  const connect = async () => {
    const server = new McpServer({ name: "fake", version: "1" });
    server.tool("echo", "echoes text", { text: z.string() }, async ({ text }) => ({
      content: [{ type: "text", text: `echo:${text}` }],
    }));
    server.tool("slow", "never answers in time", {}, async () => {
      await Bun.sleep(slow ? 60_000 : 1);
      return { content: [{ type: "text", text: "late" }] };
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    opened++;
    const close = clientSide.close.bind(clientSide);
    let done = false;
    clientSide.close = async () => {
      if (!done) {
        done = true;
        closed++;
      }
      await close();
    };
    return clientSide;
  };
  // Plugins with settings (Google's OAuth client) seal them in the connection store; the secrets stay in memory here, the rows are real.
  const sealed = new Map<string, { owner: string; secret: string }>();
  const connections = {
    configured: () => true,
    create: async (
      a: { userId: string },
      v: { secret: string; provider: string; label: string },
    ) => {
      const id = uuidv7(),
        now = new Date();
      await db.insert(connection).values({
        id,
        ownerUserId: a.userId,
        kind: "api-key",
        provider: v.provider,
        label: v.label,
        state: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        currentCredentialVersion: 1,
      });
      sealed.set(id, { owner: a.userId, secret: v.secret });
      return { id };
    },
    list: async (a: { userId: string }) =>
      [...sealed].filter(([, c]) => c.owner === a.userId).map(([id]) => ({ id, revision: 1 })),
    revoke: async (_a: unknown, id: string) => {
      sealed.delete(id);
    },
    secretFor: async (a: { userId: string }, id: string) => {
      const c = sealed.get(id);
      if (!c || c.owner !== a.userId) throw new Error("nope");
      return Buffer.from(c.secret);
    },
  } as never;
  const mcp = createMcp(db, connections, {
    callMs: 400,
    allowPrivate: true,
    stdioAllowlist: [{ command: "/usr/bin/true", args: [] }],
    connect,
    memberStdio: true,
  });
  const scripted: string[] = [];
  const prompts: string[] = [];
  const run = Object.assign(
    async (t: { prompt: string }) => {
      prompts.push(t.prompt);
      return { text: scripted.shift() ?? "x", stopped: false };
    },
    {
      stream: async function* (t: { prompt: string }) {
        prompts.push(t.prompt);
        yield scripted.shift() ?? "done";
      },
    },
  );
  const features = createFeaturesService(
    db,
    run as never,
    undefined,
    undefined,
    createSources(db, undefined, {
      allowPrivate: true,
      fetcher: async (u) =>
        u.includes("bad")
          ? Promise.reject(new Error("down"))
          : `<rss><item><title>Item from ${u}</title><link>${u}/1</link></item></rss>`,
    }) as never,
  );
  const sources = createSources(db, undefined, {
    allowPrivate: true,
    fetcher: async (u) =>
      u.includes("bad")
        ? Promise.reject(new Error("down"))
        : `<rss><item><title>Item from ${u}</title><link>${u}/1</link></item></rss>`,
  });
  const chat = createChatService(
    db,
    run as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mcp,
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    integrations: { access, mcp, sources },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
  });
  afterAll(async () => {
    await db.$client.query("delete from bot_integration where owner_user_id = any($1)", [ids]);
    await db.$client.query("delete from mcp_server where owner_user_id = any($1)", [ids]);
    await db.$client.query("delete from source where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids);
  });

  test("a local (stdio) server is for the administrator unless members are allowed", async () => {
    const strict = createMcp(db, undefined, {
      stdioAllowlist: [{ command: "/usr/bin/true", args: [] }],
      connect,
      memberStdio: false,
    });
    const member = await strict
      .addServer(
        { userId: A, isAdmin: false },
        { name: "local", transport: "stdio", command: "/usr/bin/true" },
      )
      .catch((e) => e);
    expect(member).toMatchObject({ code: "STDIO_NOT_ALLOWED" });
    expect(
      await strict.addServer(
        { userId: A, isAdmin: true },
        { name: "local-admin", transport: "stdio", command: "/usr/bin/true" },
      ),
    ).toMatchObject({ name: "local-admin" });
  });
  test("a team configuration can be bound by any member and is removed only by the administrator; a private one stays private", async () => {
    const admin = { userId: A, isAdmin: true },
      mate = { userId: B, isAdmin: false };
    const priv = await mcp.addNative(admin, "whatsapp");
    const botB = (await call(B, "POST", "/api/bots", { name: "Sender" })).json.bot.id as string;
    await expect(mcp.bind(mate, botB, priv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const team = await mcp.addNative(admin, "whatsapp", undefined, "team"); // the admin may hold both
    await mcp.bind(mate, botB, team.id);
    expect((await mcp.bound(mate, botB)).map((b) => [b.name, b.sharing, b.ownerUserId])).toEqual([
      ["whatsapp", "team", A],
    ]);
    await expect(mcp.removeServer(mate, team.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await mcp.removeServer(admin, team.id);
    expect(await mcp.bound(mate, botB)).toEqual([]);
    expect(await mcp.serverByName(admin, "whatsapp")).toMatchObject({ id: priv.id });
  });

  test("servers are per user; tools only through a per-user binding; sessions are always closed; stdio needs the allowlist", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Tooly" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true, visibility = 'team' where id = $1", [
      bot,
    ]);
    const srv = (
      await call(A, "POST", "/api/mcp/servers", {
        name: "files",
        transport: "http",
        url: "https://mcp.example.test/mcp",
      })
    ).json.server.id as string;
    expect(
      (
        await call(A, "POST", "/api/mcp/servers", {
          name: "evil",
          transport: "stdio",
          command: "/bin/rm",
          args: ["-rf", "/"],
        })
      ).status,
    ).toBe(400); // not allowlisted
    expect(
      (
        await call(A, "POST", "/api/mcp/servers", {
          name: "ok",
          transport: "stdio",
          command: "/usr/bin/true",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(A, "POST", "/api/mcp/servers", {
          name: "ok2",
          transport: "stdio",
          command: "/usr/bin/true",
          args: ["-e", "evil"],
        })
      ).status,
    ).toBe(400); // an allowlisted command with extra arguments is a different program
    expect((await call(B, "GET", "/api/mcp/servers")).json.servers).toHaveLength(0);
    expect((await call(B, "GET", `/api/mcp/servers/${srv}/tools`)).status).toBe(404);
    expect((await call(B, "PUT", `/api/bots/${bot}/integrations/${srv}`)).status).toBe(404); // B cannot bind A's server
    const tools = (await call(A, "GET", `/api/mcp/servers/${srv}/tools`)).json.tools
      .map((t: { name: string }) => t.name)
      .sort();
    expect(tools).toEqual(["echo", "slow"]);
    expect(opened).toBe(closed);
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    const say = (t: string) =>
      call(A, "POST", `/api/conversations/${conv}/messages`, { content: t });
    // unbound -> the tool is refused and the bot is told
    scripted.push(
      '```zetta:mcp\n{"server":"files","tool":"echo","args":{"text":"hi"}}\n```',
      "gave up",
    );
    expect((await say("use files")).json.assistant.content).toContain("didn't work");
    expect((await call(A, "PUT", `/api/bots/${bot}/integrations/${srv}`)).status).toBe(200);
    prompts.length = 0;
    scripted.push(
      '```zetta:mcp\n{"server":"files","tool":"echo","args":{"text":"hi"}}\n```',
      "The tool said echo:hi",
    );
    const r = await say("use files again");
    expect(r.json.assistant.content).toContain("The tool said echo:hi");
    expect(prompts.some((p) => p.includes("Tool results") && p.includes("echo:hi"))).toBe(true);
    expect(opened).toBe(closed); // every session was closed
    // B chatting with A's (team) bot has no binding of their own -> cannot use A's server
    const cb = (await call(B, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    scripted.push(
      '```zetta:mcp\n{"server":"files","tool":"echo","args":{"text":"x"}}\n```',
      "nope",
    );
    expect(
      (await call(B, "POST", `/api/conversations/${cb}/messages`, { content: "try" })).json
        .assistant.content,
    ).toContain("didn't work");
    // deleting the server removes bindings
    expect((await call(A, "DELETE", `/api/mcp/servers/${srv}`)).status).toBe(200);
    expect((await call(A, "GET", `/api/bots/${bot}/integrations`)).json.servers).toHaveLength(0);
  });

  test("a bot limited to selected tools is refused the others, and every call leaves an audit row", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Picky" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    const srv = (
      await call(A, "POST", "/api/mcp/servers", {
        name: "picky-files",
        transport: "http",
        url: "https://mcp.example.test/picky",
      })
    ).json.server.id as string;
    await call(A, "PUT", `/api/bots/${bot}/integrations/${srv}`);
    const path = `/api/bots/${bot}/integrations/${srv}/tools`;
    const open = (await call(A, "GET", path)).json;
    expect(open.toolsMode).toBe("all");
    expect(open.tools.map((t: { name: string }) => t.name).sort()).toEqual(["echo", "slow"]);
    expect(
      (await call(A, "PUT", path, { toolsMode: "selected", allowedTools: ["nope"] })).status,
    ).toBe(400); // not in the catalogue
    expect((await call(B, "PUT", path, { toolsMode: "all", allowedTools: [] })).status).toBe(404); // not B's binding
    const asA = { userId: A, isAdmin: false } as never;
    await call(A, "PUT", path, { toolsMode: "selected", allowedTools: [] });
    expect((await mcp.runConfig(asA, bot)).mcp).toBeUndefined(); // nothing allowed -> the CLI gets no server
    expect(
      (await call(A, "PUT", path, { toolsMode: "selected", allowedTools: ["slow"] })).json,
    ).toEqual({ toolsMode: "selected", allowedTools: ["slow"] });
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    const say = (t: string) =>
      call(A, "POST", `/api/conversations/${conv}/messages`, { content: t });
    scripted.push(
      '```zetta:mcp\n{"server":"picky-files","tool":"echo","args":{"text":"hi"}}\n```',
      "gave up",
    );
    expect((await say("echo please")).json.assistant.content).toContain("didn't work");
    let events = (await call(A, "GET", "/api/activity?kind=tool_call")).json.events as {
      botId: string;
      outcome: string;
      detail: string;
      subjectId: string;
    }[];
    expect(events.find((e) => e.botId === bot && e.detail === "mcp:echo")).toMatchObject({
      outcome: "denied",
      subjectId: srv,
    });
    await call(A, "PUT", path, { toolsMode: "selected", allowedTools: ["echo"] });
    expect((await mcp.runConfig(asA, bot)).mcp).toEqual({
      servers: { "picky-files": { type: "http", url: "https://mcp.example.test/picky" } },
      allow: ["mcp__picky-files__echo"],
    });
    scripted.push(
      '```zetta:mcp\n{"server":"picky-files","tool":"echo","args":{"text":"hi"}}\n```',
      "The tool said echo:hi",
    );
    expect((await say("echo again")).json.assistant.content).toContain("The tool said echo:hi");
    events = (await call(A, "GET", "/api/activity?kind=tool_call")).json.events;
    expect(
      events.find((e) => e.botId === bot && e.detail === "mcp:echo" && e.outcome === "ok"),
    ).toMatchObject({ subjectId: srv });
    expect(opened).toBe(closed);
  });

  test("a failing plugin call tells the bot and the user why, and an identical retry is not run again", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Mailer" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    expect(
      (
        await call(A, "POST", "/api/plugins", {
          id: "google",
          sealed: await sealedFor(A, "plugin.install:google", { config: {} }),
          botIds: [bot],
        })
      ).status,
    ).toBe(201); // installed but never connected
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation.id;
    const block =
      '```zetta:plugin\n{"plugin":"google","tool":"gmail_search","args":{"query":"from:x"}}\n```';
    scripted.push(block, block, "Google is not connected.");
    prompts.length = 0;
    const r = await call(A, "POST", `/api/conversations/${conv}/messages`, {
      content: "check my mail",
    });
    expect(r.json.assistant.content).toContain(
      "Google (Gmail, Calendar, Drive): gmail search didn't work",
    );
    expect(r.json.assistant.content).toContain("What you can do:");
    expect(r.json.assistant.content).toContain("Then ask Mailer to try again");
    expect(
      prompts.some((p) =>
        /failed \((NEEDS_AUTH|NOT_CONFIGURED)\): .*To fix it the user can: /.test(p),
      ),
    ).toBe(true);
    expect(prompts.some((p) => p.includes("already failed in this turn"))).toBe(true);
    expect((r.json.assistant.content.match(/didn't work/g) ?? []).length).toBe(1); // the repeat was refused, not run
  });

  test("a hung server times out and its session is still closed", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Patient" })).json.bot.id as string;
    const srv = (
      await call(A, "POST", "/api/mcp/servers", {
        name: "slowpoke",
        transport: "http",
        url: "https://mcp2.example.test/mcp",
      })
    ).json.server.id as string;
    await call(A, "PUT", `/api/bots/${bot}/integrations/${srv}`);
    const before = { o: opened, c: closed };
    slow = true;
    const t0 = Date.now();
    const res = await mcp
      .callTool({ userId: A, isAdmin: false } as never, bot, "slowpoke", "slow", {})
      .then(
        () => "ok",
        (e) => (e as { code: string }).code,
      );
    slow = false;
    expect(res).toBe("TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(opened - before.o).toBe(closed - before.c);
  }, 40_000);

  test("sources: private addresses are blocked, briefings report gaps instead of inventing content, owner-scoped", async () => {
    const strict = createSources(db, undefined, {});
    expect(
      await strict
        .add({ userId: A, isAdmin: false } as never, {
          kind: "rss",
          url: "http://localhost:3000/feed",
          label: "local",
        })
        .then(
          () => "ok",
          (e) => e.code,
        ),
    ).toBe("BLOCKED");
    const good = (
      await call(A, "POST", "/api/sources", {
        kind: "rss",
        url: "https://blog.example.test/feed",
        label: "Blog",
      })
    ).json.source.id;
    await call(A, "POST", "/api/sources", {
      kind: "rss",
      url: "https://bad.example.test/feed",
      label: "Broken",
    });
    expect((await call(B, "GET", "/api/sources")).json.sources).toHaveLength(0);
    const b = (await call(A, "POST", "/api/sources/briefing", {})).json;
    expect(b.gaps).toEqual(["Broken"]);
    expect(b.prompt).toContain("Item from https://blog.example.test/feed");
    expect(b.prompt).toContain("## Broken\n(could not be read)");
    expect((await call(B, "DELETE", `/api/sources/${good}`)).status).toBe(404);
  });

  test("a workflow can feed followed sources to a bot (source -> briefing flow)", async () => {
    const bot = (await call(A, "POST", "/api/bots", { name: "Briefer2" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [bot]);
    const wf = (
      await call(A, "POST", "/api/workflows", {
        name: "briefing",
        graph: {
          start: "s",
          nodes: {
            s: { type: "sources", next: "p" },
            p: { type: "prompt", botId: bot, template: "Summarize:\n{{prev}}", next: "e" },
            e: { type: "end" },
          },
        },
      })
    ).json.workflow;
    prompts.length = 0;
    const r = await call(A, "POST", `/api/workflows/${wf.id}/run`, { input: "" });
    expect(r.json.run.status).toBe("succeeded");
    expect(prompts.at(-1)).toContain("Item from https://blog.example.test/feed");
    expect(prompts.at(-1)).toContain("could not be read");
  });

  test("a plugin config is accepted only sealed, for this user and this plugin", async () => {
    const TOKEN = "tg-test-token-1234567890";
    expect(
      (
        await call(A, "POST", "/api/plugins", {
          id: "telegram",
          config: { token: TOKEN },
          botIds: [],
        })
      ).status,
    ).toBe(400); // plaintext config
    const wrongPlugin = await sealedFor(A, "plugin.install:google", { config: { token: TOKEN } });
    expect(
      (await call(A, "POST", "/api/plugins", { id: "telegram", sealed: wrongPlugin, botIds: [] }))
        .status,
    ).toBe(400);
    const forB = await sealedFor(B, "plugin.install:telegram", { config: { token: TOKEN } });
    expect(
      (await call(A, "POST", "/api/plugins", { id: "telegram", sealed: forB, botIds: [] })).status,
    ).toBe(400);
    const install = await sealedFor(A, "plugin.install:telegram", { config: { token: TOKEN } });
    expect((await call(A, "PUT", "/api/plugins/telegram/config", { sealed: install })).status).toBe(
      400,
    ); // an install body cannot be replayed as a configure
  });
});
