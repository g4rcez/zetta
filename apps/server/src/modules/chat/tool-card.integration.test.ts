import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import {
  PluginPause,
  registerPlugin,
  type PluginAnswer,
  type PluginPauseInfo,
} from "../integrations/plugins/registry";
import { actor, world } from "../integrations/plugins/test-world";
import { untrustedDoc } from "../integrations/plugins/untrusted";
import { createChatService } from "./service";

/**
 * A tool call that stops for the person: one card, the bot waits, the person's answer reaches the plugin, and the bot gets the result as
 * a new message. The plugin here is a stand-in that pauses when asked; the mechanism is the same for every pausing tool (apps, plugins).
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = `tool-${uuidv7()}`;

const resumed: { requestId: string; answer: PluginAnswer }[] = [];
let onResume: (requestId: string, answer: PluginAnswer) => string = () => "done";
const pauseOf = (a: Record<string, unknown>): PluginPause => {
  const info: PluginPauseInfo = {
    requestId: String(a.id),
    mode: a.mode === "form" ? "input" : "approval",
    tool: String(a.tool ?? "issues.close"),
    message: a.mode === "form" ? "New title?" : "Approve issues.close?",
    ...(a.mode === "form"
      ? { fields: [{ key: "title", label: "Title", type: "string" as const, required: true }] }
      : { input: '{"number":7}' }),
    expiresAt: Date.now() + 60 * 60_000,
  };
  return new PluginPause(info, "pause-fake");
};
registerPlugin({
  id: "pause-fake",
  name: "Pause fake",
  description: "Only for the approval card tests.",
  icon: "plug",
  category: "other",
  kind: "native",
  auth: "none",
  fields: [],
  tools: [
    {
      name: "ask",
      description: "Stops for the person's answer",
      effect: "write",
      inputSchema: { type: "object", properties: {} },
      async handler(_ctx, args) {
        throw pauseOf(args);
      },
    },
  ],
  pausing: {
    async resume(_ctx, requestId, answer) {
      resumed.push({ requestId, answer });
      return onResume(requestId, answer);
    },
  },
});

const fence = (args: Record<string, unknown>) =>
  `\`\`\`zetta:plugin\n${JSON.stringify({ plugin: "pause-fake", tool: "ask", args })}\n\`\`\``;

suite("approval cards for paused tool calls, against compose postgres", () => {
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
    undefined,
    undefined,
    undefined,
    undefined,
    // Background work (the sweeper that expires a card) acts as the person; the server wires this to the membership lookup.
    { backgroundActor: (userId) => issueBackgroundActor(async () => ({ isAdmin: false }), userId) },
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
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
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
  const until = async (ok: () => boolean | Promise<boolean>, ms = 6000) => {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const setup = async (name: string) => {
    const bot = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    await plugins.install(actor(USER), "pause-fake", {}, [bot.id]);
    return {
      bot,
      conv,
      say: async (content: string) =>
        (await call("POST", `/api/conversations/${conv}/messages`, { content })).json.assistant
          .content as string,
    };
  };
  const cards = async (botId: string, status = "pending") =>
    ((await call("GET", `/api/proposals?botId=${botId}`)).json.proposals as any[]).filter(
      (p) => p.kind === "tool_resume" && p.status === status,
    );
  const reset = () => {
    resumed.length = 0;
    onResume = () => "done";
  };

  test("a call that needs approval becomes one card and the bot is told to wait; nothing ran", async () => {
    reset();
    const { bot, say } = await setup("Closer");
    script = [fence({ id: "apr_1" }), "I asked you to approve it."];
    prompts.length = 0;
    await say("close issue 7");
    const found = await cards(bot.id);
    expect(found.length).toBe(1);
    expect(found[0].patch.pause.requestId).toBe("apr_1");
    expect(found[0].patch.pluginTool).toBe("ask");
    expect(JSON.stringify(found[0].diff)).toContain("number");
    expect(prompts.join("\n")).toContain("waiting for the user");
    expect(resumed).toEqual([]);
    await plugins.uninstall(actor(USER), "pause-fake");
  });

  test("approving continues the call and the bot gets the result in a new message", async () => {
    reset();
    onResume = () => untrustedDoc("Pause fake", {}, "closed 7");
    const { bot, say } = await setup("Approved");
    script = [fence({ id: "apr_2" }), "Waiting for you."];
    await say("close issue 7");
    const [card] = await cards(bot.id);
    script = ["Closed it for you."];
    prompts.length = 0;
    const r = await call("POST", `/api/proposals/${card.id}/decision`, { approve: true });
    expect(r.status).toBe(200);
    await until(() => resumed.length === 1);
    expect(resumed[0]).toEqual({ requestId: "apr_2", answer: { action: "accept", content: {} } });
    await until(() => prompts.some((p) => p.includes("The user approved")));
    const fed = prompts.find((p) => p.includes("The user approved"))!;
    expect(fed).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(fed).toContain("closed 7");
    expect(await cards(bot.id)).toHaveLength(0);
    await plugins.uninstall(actor(USER), "pause-fake");
  });

  test("declining tells the plugin no, and the bot is told not to go around it", async () => {
    reset();
    const { bot, say } = await setup("Declined");
    script = [fence({ id: "apr_3" }), "Waiting."];
    await say("close issue 7");
    const [card] = await cards(bot.id);
    script = ["Understood, I will not close it."];
    prompts.length = 0;
    await call("POST", `/api/proposals/${card.id}/decision`, { approve: false });
    await until(() => resumed.length === 1);
    expect(resumed[0]!.answer).toEqual({ action: "decline" });
    await until(() => prompts.some((p) => p.includes("The user declined")));
    expect(prompts.find((p) => p.includes("The user declined"))).toContain("Do not try it again");
    await plugins.uninstall(actor(USER), "pause-fake");
  });

  test("a form card takes only the fields that were asked for", async () => {
    reset();
    const { bot, say } = await setup("Former");
    script = [fence({ id: "elc_4", mode: "form", tool: "issues.rename" }), "Waiting."];
    await say("rename issue 7");
    const [card] = await cards(bot.id);
    expect(card.patch.pause.mode).toBe("input");
    const decide = (body: object) =>
      call("POST", `/api/proposals/${card.id}/decision`, { approve: true, ...body });
    // Wrong field, missing required field, wrong type: refused before the card is used up.
    expect((await decide({ answer: { bogus: "x" } })).status).toBeGreaterThanOrEqual(400);
    expect((await decide({})).status).toBeGreaterThanOrEqual(400);
    expect((await decide({ answer: { title: 5 } })).status).toBeGreaterThanOrEqual(400);
    expect(await cards(bot.id)).toHaveLength(1);
    expect(resumed).toEqual([]);
    script = ["Renamed."];
    expect((await decide({ answer: { title: "Better title" } })).status).toBe(200);
    await until(() => resumed.length === 1);
    expect(resumed[0]!.answer).toEqual({ action: "accept", content: { title: "Better title" } });
    await plugins.uninstall(actor(USER), "pause-fake");
  });

  test("a call that stops again after the answer gets a second card for the same tool", async () => {
    reset();
    let n = 0;
    onResume = () => {
      if (n++ === 0) throw pauseOf({ id: "apr_5b" });
      return "done";
    };
    const { bot, say } = await setup("Twice");
    script = [fence({ id: "apr_5a" }), "Waiting."];
    await say("close it");
    const [first] = await cards(bot.id);
    await call("POST", `/api/proposals/${first.id}/decision`, { approve: true });
    await until(async () => (await cards(bot.id)).length === 1);
    const [next] = await cards(bot.id);
    expect(next.patch.pause.requestId).toBe("apr_5b");
    expect(next.patch.pluginTool).toBe("ask");
    await plugins.uninstall(actor(USER), "pause-fake");
  });

  test("a bot cannot answer for the person: there is no tool that resumes", async () => {
    reset();
    const { bot, say } = await setup("Cheater");
    script = [
      fence({ id: "apr_6" }),
      '```zetta:plugin\n{"plugin":"pause-fake","tool":"resume","args":{"requestId":"apr_6"}}\n```',
      "Done.",
    ];
    await say("close it");
    expect(resumed).toEqual([]);
    expect(await cards(bot.id)).toHaveLength(1);
    await plugins.uninstall(actor(USER), "pause-fake");
  });

  test("a card nobody answers expires, and the bot is told it did not run", async () => {
    reset();
    const { bot, say } = await setup("Waiter");
    script = [fence({ id: "apr_7" }), "Waiting."];
    await say("close it");
    const [card] = await cards(bot.id);
    await db.$client.query(
      "update config_proposal set expires_at = now() - interval '1 hour' where id = $1",
      [card.id],
    );
    script = ["Then I will not do it."];
    prompts.length = 0;
    expect(await chat.expireProposals()).toBeGreaterThanOrEqual(1);
    await until(() => prompts.some((p) => p.includes("Nobody answered the approval")));
    expect(resumed).toEqual([]);
    expect(await cards(bot.id)).toHaveLength(0);
    await plugins.uninstall(actor(USER), "pause-fake");
  });
});
