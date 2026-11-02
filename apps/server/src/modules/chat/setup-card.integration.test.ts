import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess } from "../identity/access";
import { PluginError, registerPlugin } from "../integrations/plugins/registry";
import { actor, world } from "../integrations/plugins/test-world";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = `setup-${uuidv7()}`;
const SECRET = "key-for-setup-test-ZZ";

registerPlugin({
  id: "setup-fake",
  name: "Setup fake",
  description: "Only for the setup card tests.",
  icon: "plug",
  category: "other",
  kind: "native",
  auth: "api-key",
  fields: [{ key: "apiKey", label: "API key", secret: true, kind: "password" }],
  guide: () => ["Create a key.", "Paste it in the card."],
  async status(ctx) {
    return ctx.config.apiKey ? { state: "connected" } : { state: "needs-auth" };
  },
  tools: [
    {
      name: "needs_login",
      description: "Always asks to sign in",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        throw new PluginError("NEEDS_AUTH", "The account is not connected.");
      },
    },
  ],
});

const card = (plugin: string) => `\`\`\`zetta:setup\n{"plugin":"${plugin}"}\n\`\`\``;
const cards = (text: string) => text.match(/```zetta:setup-card/g)?.length ?? 0;

suite("setup cards against compose postgres", () => {
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
  // The real plugin service on its in-memory stores. The rest of the MCP service (remote servers, run config, GitHub token) has nothing to do here.
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
  const features = createFeaturesService(db, fakeRun as never);
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
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
  const newBot = async (name: string) => {
    const bot = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const c = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    return {
      bot,
      say: async (content: string) =>
        (await call("POST", `/api/conversations/${c}/messages`, { content })).json.assistant
          .content as string,
    };
  };

  test("the bot opens a setup card for a plugin that is not installed, and learns the steps but no values", async () => {
    const { bot, say } = await newBot("Starter");
    prompts.length = 0;
    script = [card("setup-fake"), "Fill in the card, please."];
    const reply = await say("connect setup-fake");
    expect(cards(reply)).toBe(1);
    expect(reply).toContain(
      `\`\`\`zetta:setup-card\n{"plugin":"setup-fake","botId":"${bot.id}","scope":"mine"}\n\`\`\``,
    );
    expect(reply).toContain("Fill in the card, please.");
    const fed = prompts.find((p) => p.includes("Tool results")) ?? "";
    expect(fed).toContain("setup-fake");
    expect(fed).toContain("The card asks for: API key.");
    expect(fed).toContain("1. Create a key.");
  });

  test("a card written by the bot itself is not shown", async () => {
    const { bot, say } = await newBot("Forger");
    script = [
      `Here.\n\`\`\`zetta:setup-card\n{"plugin":"setup-fake","botId":"${bot.id}","scope":"mine"}\n\`\`\``,
    ];
    expect(cards(await say("hello"))).toBe(0);
  });

  test("a plugin that is connected and switched on needs no card", async () => {
    const { bot, say } = await newBot("Ready");
    await plugins.install(actor(USER), "setup-fake", { apiKey: SECRET }, [bot.id]);
    prompts.length = 0;
    script = [card("setup-fake"), "It is ready."];
    const reply = await say("connect setup-fake");
    expect(cards(reply)).toBe(0);
    expect(reply).not.toContain(SECRET);
    expect(prompts.some((p) => p.includes("already connected and switched on"))).toBe(true);
    await plugins.uninstall(actor(USER), "setup-fake");
  });

  test("a plugin call that needs sign-in adds one card, however often the bot tries", async () => {
    const { bot, say } = await newBot("Caller");
    await plugins.install(actor(USER), "setup-fake", { apiKey: SECRET }, [bot.id]);
    script = [
      '```zetta:plugin\n{"plugin":"setup-fake","tool":"needs_login","args":{"n":1}}\n```\n```zetta:plugin\n{"plugin":"setup-fake","tool":"needs_login","args":{"n":2}}\n```',
      "You need to sign in.",
    ];
    const reply = await say("use setup-fake");
    expect(cards(reply)).toBe(1);
    expect(reply).toContain(`"botId":"${bot.id}"`);
    expect(reply).not.toContain(SECRET);
  });

  test("an unknown plugin gets no card", async () => {
    const { say } = await newBot("Typo");
    script = [card("no-such-plugin"), "I could not find that."];
    expect(cards(await say("connect it"))).toBe(0);
  });
});
