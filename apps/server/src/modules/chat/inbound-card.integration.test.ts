import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { inboundRoute } from "@zetta/db/schema/inbound";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { registerPlugin } from "../integrations/plugins/registry";
import { actor, world } from "../integrations/plugins/test-world";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = `inbcard-${uuidv7()}`;
const SECRET = "key-for-inbound-card-ZZ";
const PLUGIN = "chan-fake";

registerPlugin({
  id: PLUGIN,
  name: "Chan fake",
  description: "Only for the inbound card tests.",
  icon: "plug",
  category: "messaging",
  kind: "native",
  auth: "api-key",
  fields: [
    { key: "apiKey", label: "API key", secret: true, kind: "password" },
    { key: "baseUrl", label: "Server address", kind: "url", optional: true },
    { key: "hookUrl", label: "Zetta address", kind: "url", optional: true, botEditable: true },
  ],
  inbound: {
    label: "Chan",
    reply: { tool: "send", chatArg: "chat", normalize: (c) => c },
    poll: async () => ({ events: [], cursor: null }),
  },
  tools: [
    {
      name: "send",
      description: "send",
      inputSchema: { type: "object", properties: { chat: { type: "string" } } },
      handler: async () => "ok",
    },
  ],
});

const block = (body: unknown) => `\`\`\`zetta:inbound\n${JSON.stringify(body)}\n\`\`\``;
const cards = (text: string) => text.match(/```zetta:inbound-card/g)?.length ?? 0;

suite("inbound cards against compose postgres", () => {
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
  let script: string[] = [];
  const prompts: string[] = [];
  const fakeRun = Object.assign(
    async (t: { prompt: string }) => {
      prompts.push(t.prompt);
      return { text: script.shift() ?? "done", stopped: false };
    },
    {
      stream: async function* (t: { prompt: string }) {
        prompts.push(t.prompt);
        yield script.shift() ?? "done";
      },
    },
  );
  const { plugins } = world();
  const chat = createChatService(
    db,
    fakeRun as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      plugins,
      openScope: () => undefined,
      runConfig: async () => undefined,
      tokenOf: async () => undefined,
      isBound: async () => false,
    } as never,
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": USER,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: USER,
      name: USER,
      email: `${USER}@example.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: USER, status: "active" as const, joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [USER]);
  });
  const newBot = async (name: string, install = true) => {
    const bot = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    if (install) await plugins.install(actor(USER), PLUGIN, { apiKey: SECRET }, [bot.id]);
    const c = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    return {
      bot,
      say: async (content: string) =>
        (await call("POST", `/api/conversations/${c}/messages`, { content })).json.assistant
          .content as string,
    };
  };
  const reset = async () => {
    await plugins.uninstall(actor(USER), PLUGIN).catch(() => {});
    prompts.length = 0;
  };

  test("status tells the bot what is missing, and shows no secret", async () => {
    const { say } = await newBot("Reader");
    script = [block({ action: "status", plugin: PLUGIN }), "Not on yet."];
    await say("is it on?");
    const fed = prompts.find((p) => p.includes("Tool results")) ?? "";
    expect(fed).toContain("Incoming Chan messages: never turned on.");
    expect(fed).toContain("there is no address saved");
    expect(fed).toContain("hookUrl (Zetta address) = empty");
    expect(fed).not.toContain(SECRET);
    await reset();
  });

  test("a proposal shows the user a card with the exact change and saves nothing", async () => {
    const { bot, say } = await newBot("Proposer");
    script = [
      block({
        action: "propose",
        plugin: PLUGIN,
        incoming: "on",
        who: "direct",
        settings: { hookUrl: "http://host.docker.internal:3000" },
      }),
      "Press Apply.",
    ];
    const reply = await say("turn on instant messages");
    expect(cards(reply)).toBe(1);
    expect(reply).toContain(
      `\`\`\`zetta:inbound-card\n{"plugin":"${PLUGIN}","pluginName":"Chan fake","botId":"${bot.id}","botName":"Proposer","settings":[{"key":"hookUrl","label":"Zetta address","from":"","to":"http://host.docker.internal:3000"}],"incoming":{"state":"on","filter":{"direct":true,"groups":false,"chats":[]}}}\n\`\`\``,
    );
    expect(reply).toContain("Press Apply.");
    expect((await plugins.botSettings(actor(USER), PLUGIN)).settings[0]!.value).toBe("");
    expect(await db.select().from(inboundRoute).where(eq(inboundRoute.ownerUserId, USER))).toEqual(
      [],
    );
    await reset();
  });

  test("a secret or an address the plugin did not open is refused: no card, and the bot is told why", async () => {
    const { say } = await newBot("Greedy");
    script = [
      block({ action: "propose", plugin: PLUGIN, settings: { apiKey: "mine-now" } }),
      block({ action: "propose", plugin: PLUGIN, settings: { baseUrl: "http://evil.test" } }),
      "Could not.",
    ];
    expect(cards(await say("change the key"))).toBe(0);
    const fed = prompts.filter((p) => p.includes("Tool results")).join("\n");
    expect(fed).toContain('A bot cannot change "apiKey"');
    await reset();
  });

  test("turning on needs the plugin switched on for the bot first", async () => {
    const { say } = await newBot("Unbound", false);
    await plugins.install(actor(USER), PLUGIN, { apiKey: SECRET }, []);
    script = [block({ action: "propose", plugin: PLUGIN, incoming: "on" }), "Need setup."];
    expect(cards(await say("turn it on"))).toBe(0);
    expect(prompts.some((p) => p.includes("is not switched on for you"))).toBe(true);
    await reset();
  });

  test("the same card is not shown twice in one reply, and a change that is already in place is not proposed", async () => {
    const { bot, say } = await newBot("Twice");
    const change = {
      action: "propose",
      plugin: PLUGIN,
      settings: { hookUrl: "http://host.docker.internal:3000" },
    };
    script = [`${block(change)}\n${block(change)}`, "Press Apply."];
    expect(cards(await say("set it"))).toBe(1);
    await plugins.configure(actor(USER), PLUGIN, { hookUrl: "http://host.docker.internal:3000" });
    await db.insert(inboundRoute).values({
      ownerUserId: USER,
      botId: bot.id,
      pluginId: PLUGIN,
      enabled: true,
      filter: { direct: true, groups: false, chats: [] },
      cursor: { hook: "http://host.docker.internal:3000/x" },
    });
    prompts.length = 0;
    script = [block({ ...change, incoming: "on" }), "Nothing to do."];
    expect(cards(await say("set it again"))).toBe(0);
    expect(prompts.some((p) => p.includes("nothing to change"))).toBe(true);
    script = [block({ action: "status", plugin: PLUGIN }), "It is on."];
    await say("status?");
    expect(prompts.some((p) => p.includes("Instant delivery (push): active."))).toBe(true);
    await db.delete(inboundRoute).where(eq(inboundRoute.ownerUserId, USER));
    await reset();
  });
});
