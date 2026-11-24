import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess } from "../identity/access";
import { registerPlugin } from "../integrations/plugins/registry";
import { actor, world } from "../integrations/plugins/test-world";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = `progress-${uuidv7()}`;

registerPlugin({
  id: "progress-fake",
  name: "Progress fake",
  description: "Only for the plugin progress test.",
  icon: "plug",
  category: "other",
  kind: "native",
  auth: "api-key",
  fields: [],
  guide: () => ["Nothing to set up."],
  async status() {
    return { state: "connected" };
  },
  tools: [
    {
      name: "slow",
      description: "Reports progress, then answers",
      inputSchema: { type: "object", properties: {} },
      async handler(ctx) {
        ctx.progress?.({ text: "Downloading video · 10%", percent: 10 });
        // Inside the same second: held back, and only the latest of a burst goes out a moment later.
        ctx.progress?.({ text: "Downloading video · 40%", percent: 40 });
        ctx.progress?.({ text: "Downloading video · 60%", percent: 60 });
        await new Promise((r) => setTimeout(r, 1400));
        return { ok: true };
      },
    },
  ],
});

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
    return { bot, convId: c };
  };

  test("a plugin call tells the chat how far it is while it runs", async () => {
    const { bot, convId } = await newBot("Downloader");
    await plugins.install(actor(USER), "progress-fake", {}, [bot.id]);
    script = [
      '```zetta:plugin\n{"plugin":"progress-fake","tool":"slow","args":{}}\n```',
      "It is done.",
    ];
    const person = await access.requireActive(new Headers({ "x-test-user": USER }));
    const { follow } = await chat.startTurn(person, convId, { content: "download it" });
    const seen: { type: string; label?: string; text?: string; percent?: number }[] = [];
    for await (const { event } of follow()) {
      if (event.type === "activity" || event.type === "progress") seen.push(event as never);
    }
    const progress = seen.filter((e) => e.type === "progress");
    expect(progress.map((p) => p.text)).toEqual([
      "Downloading video · 10%",
      "Downloading video · 60%",
    ]);
    expect(progress.map((p) => p.percent)).toEqual([10, 60]);
    // It belongs to the step the bot announced just before: same label.
    const step = seen.find((e) => e.type === "activity" && e.label?.includes("progress-fake"));
    expect(step).toBeDefined();
    expect(progress[0]!.label).toBe(step!.label);
    expect(seen.indexOf(step!)).toBeLessThan(seen.indexOf(progress[0]!));
  });
});
