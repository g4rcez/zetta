import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { playground, playgroundFile } from "@zetta/db/schema/playground";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createApps } from "../apps/service";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { configureApps } from "../integrations/plugins/apps";
import { world } from "../integrations/plugins/test-world";
import { createChatService } from "./service";

/**
 * The whole path with a real app: a bot's turn calls a tool, the tool changes something so a card appears and the bot waits, the person
 * answers, the tool runs (a real `bun` process), and the bot is told what came back. Everything but the model is real.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = `appc-${uuidv7()}`;

const CODE = `
import { defineApp, query, mutation, t } from "zetta-app";
export default defineApp({
  tools: {
    greet: query({ description: "Say hello", input: t.object({ name: t.string().default("world") }) }, async (_c, { name }) => ({ message: "Hello, " + name + "!" })),
    items: { remove: mutation({ description: "Remove an item", input: t.object({ id: t.string() }) }, async (_c, { id }) => ({ removed: id })) },
  },
});
`;
const fence = (path: string, input: object = {}) =>
  `\`\`\`zetta:plugin\n${JSON.stringify({ plugin: "apps", tool: "apps_call", args: { path, input } })}\n\`\`\``;

suite("a bot calls an app, against compose postgres", () => {
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
  const apps = createApps(db);
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
  const lookup = async () => ({ isAdmin: false });
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
    undefined,
    undefined,
    undefined,
    undefined,
    { backgroundActor: (userId) => issueBackgroundActor(lookup, userId) },
  );
  const features = createFeaturesService(db, fakeRun as never);
  const server = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await server.handle(
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
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const until = async (ok: () => boolean | Promise<boolean>, ms = 8000) => {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  let slug: string;
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
    configureApps({ apps, actorFor: (userId) => issueBackgroundActor(lookup, userId) });
    const actor = (await issueBackgroundActor(lookup, USER))!;
    const [p] = await db
      .insert(playground)
      .values({
        ownerUserId: USER,
        title: "Chat App",
        language: "typescript",
        runner: "host",
        entry: "index.ts",
      })
      .returning();
    await db
      .insert(playgroundFile)
      .values({ playgroundId: p!.id, path: "index.ts", content: CODE, size: CODE.length });
    slug = (await apps.publish(actor, { playgroundId: p!.id })).app.slug;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [USER]);
  });

  const newBot = async (name: string, grant: boolean) => {
    const bot = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    if (grant) {
      const actor = (await issueBackgroundActor(lookup, USER))!;
      await apps.setBotApps(actor, bot.id, [
        (await apps.list(actor)).find((x) => x.slug === slug)!.id,
      ]);
    }
    return {
      bot,
      say: async (content: string) =>
        (await call("POST", `/api/conversations/${conv}/messages`, { content })).json.assistant
          .content as string,
    };
  };
  const cards = async (botId: string, status = "pending") =>
    ((await call("GET", `/api/proposals?botId=${botId}`)).json.proposals as any[]).filter(
      (p) => p.kind === "tool_resume" && p.status === status,
    );

  test("a query runs in the turn and its answer reaches the bot as data", async () => {
    const { say } = await newBot("Reader", true);
    prompts.length = 0;
    script = [fence(`apps.${slug}.greet`, { name: "Zetta" }), "It said hello."];
    await say("greet Zetta");
    const joined = prompts.join("\n");
    expect(joined).toContain("Hello, Zetta!");
    expect(joined).toContain("UNTRUSTED EXTERNAL CONTENT");
  });

  test("a bot with no grant is refused, and the app is not run", async () => {
    const { say } = await newBot("Bare", false);
    prompts.length = 0;
    script = [fence(`apps.${slug}.greet`), "I could not."];
    await say("greet");
    const joined = prompts.join("\n");
    expect(joined).toContain("NOT_BOUND");
    expect(joined).not.toContain("Hello, world!");
  });

  test("a change stops for a card; approving runs the tool in a real process and tells the bot", async () => {
    const { bot, say } = await newBot("Remover", true);
    script = [fence(`apps.${slug}.items.remove`, { id: "42" }), "I asked for your approval."];
    prompts.length = 0;
    await say("remove item 42");
    const [card] = await cards(bot.id);
    expect(card.patch.plugin).toBe("apps");
    expect(card.patch.pluginTool).toBe("apps_call");
    expect(card.patch.pause.tool).toBe(`${slug}.items.remove`);
    expect(card.patch.pause.input).toContain('"id":"42"');
    expect(prompts.join("\n")).toContain("waiting for the user");
    // Nothing ran yet.
    const actor = (await issueBackgroundActor(lookup, USER))!;
    expect(
      (await apps.calls(actor, slug)).filter(
        (c) => c.tool === "items.remove" && c.status === "pending_approval",
      ).length,
    ).toBe(1);

    script = ["Removed 42."];
    prompts.length = 0;
    expect(
      (await call("POST", `/api/proposals/${card.id}/decision`, { approve: true })).status,
    ).toBe(200);
    await until(() => prompts.some((p) => p.includes("The user approved")));
    const fed = prompts.find((p) => p.includes("The user approved"))!;
    expect(fed).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(fed).toContain('"removed":"42"');
    expect(
      (await apps.calls(actor, slug)).find((c) => c.id === card.patch.pause.requestId)?.status,
    ).toBe("ok");
    expect(await cards(bot.id)).toHaveLength(0);
  });

  test("declining runs nothing and the bot is told not to go round it", async () => {
    const { bot, say } = await newBot("Decliner", true);
    script = [fence(`apps.${slug}.items.remove`, { id: "13" }), "Waiting."];
    await say("remove item 13");
    const [card] = await cards(bot.id);
    script = ["Understood."];
    prompts.length = 0;
    await call("POST", `/api/proposals/${card.id}/decision`, { approve: false });
    await until(() => prompts.some((p) => p.includes("The user declined")));
    const actor = (await issueBackgroundActor(lookup, USER))!;
    const row = (await apps.calls(actor, slug)).find((c) => c.id === card.patch.pause.requestId);
    expect(row?.status).toBe("denied");
    expect(row?.result).toBeNull();
  });

  test("a card nobody answers expires, the call is not run, and the bot is told", async () => {
    const { bot, say } = await newBot("Waiter", true);
    script = [fence(`apps.${slug}.items.remove`, { id: "99" }), "Waiting."];
    await say("remove item 99");
    const [card] = await cards(bot.id);
    await db.$client.query(
      "update config_proposal set expires_at = now() - interval '1 hour' where id = $1",
      [card.id],
    );
    script = ["Then not."];
    prompts.length = 0;
    expect(await chat.expireProposals()).toBeGreaterThanOrEqual(1);
    await until(() => prompts.some((p) => p.includes("Nobody answered the approval")));
    const actor = (await issueBackgroundActor(lookup, USER))!;
    // The call row still waits; the sweeper (or a late answer) closes it. Nothing ran.
    expect(
      (await apps.calls(actor, slug)).find((c) => c.id === card.patch.pause.requestId)?.result,
    ).toBeNull();
  });
});
