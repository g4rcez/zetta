import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { app } from "@zetta/db/schema/apps";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { playground } from "@zetta/db/schema/playground";
import { eq } from "@zetta/db/query";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createAppAuthor } from "../apps/author";
import { createApps } from "../apps/service";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { world } from "../integrations/plugins/test-world";
import { createPlayground } from "../playground/service";
import { createChatService } from "./service";

/**
 * A bot builds an app in chat with zetta:app. Everything but the model is real: the tool parser, the playground, the publish, the build of
 * the page, the approval card for code that would run on the host, and the message that tells the bot how it went.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = `appb-${uuidv7()}`;

const BACKEND = `import { defineApp, query, t } from "zetta-app";
export default defineApp({ tools: { greet: query({ description: "Say hello", input: t.object({ name: t.string().default("world") }) }, async (_c, { name }) => ({ message: "Hello, " + name })) } });`;
const PAGE = `<!doctype html><html><head><title>Clock</title></head><body><h1 id="t"></h1><script>document.getElementById("t").textContent = "now";</script></body></html>`;
const fence = (args: object) => `\`\`\`zetta:app\n${JSON.stringify(args)}\n\`\`\``;

suite("a bot builds an app in chat, against compose postgres", () => {
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
  const lookup = async () => ({ isAdmin: false });
  // No container here, so backend code would run on the host: that is the case that needs the person's yes.
  const apps = createApps(db);
  const playgrounds = createPlayground(db);
  const appAuthor = createAppAuthor({ apps, playgrounds });
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
    {
      backgroundActor: (userId) => issueBackgroundActor(lookup, userId),
      playground: playgrounds,
      appAuthor,
    },
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
  const setup = async (name: string) => {
    const bot = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    const conv = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    return {
      bot,
      conv,
      say: async (content: string) =>
        (await call("POST", `/api/conversations/${conv}/messages`, { content })).json,
    };
  };
  const cards = async (botId: string, status = "pending") =>
    ((await call("GET", `/api/proposals?botId=${botId}`)).json.proposals as any[]).filter(
      (p) => p.kind === "publish_app" && p.status === status,
    );
  const myApps = () => db.select().from(app).where(eq(app.ownerUserId, USER));

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

  test("the guide is read on demand and carries the SDK, the bridge and the limits", async () => {
    const { say } = await setup("Reader");
    script = [fence({ action: "guide" }), "Got it."];
    prompts.length = 0;
    await say("make me an app");
    const fed = prompts.join("\n");
    expect(fed).toContain("window.zetta.call");
    expect(fed).toContain("ctx.storage.put");
    expect(fed).toContain("defineApp");
    expect(await myApps()).toHaveLength(0);
  });

  test("a page with no backend is published at once, and the bot is told where to find it", async () => {
    const { say, conv } = await setup("PageMaker");
    script = [
      fence({
        action: "create",
        title: "Clock",
        files: [{ path: "ui/index.html", content: PAGE }],
      }),
      "Your clock is ready.",
    ];
    prompts.length = 0;
    const r = await say("make me a clock");
    const [made] = await myApps();
    expect(made).toMatchObject({ name: "Clock", slug: "clock" });
    const fed = prompts.join("\n");
    expect(fed).toContain("app ok: clock version 1");
    expect(fed).toContain("with a page");
    // The message carries a receipt that links to the app.
    const messages = (await call("GET", `/api/conversations/${conv}/messages`)).json;
    expect(JSON.stringify(messages)).toContain('"kind":"app"');
    expect(JSON.stringify(messages)).toContain("Clock · v1");
    expect(JSON.stringify(r).length).toBeGreaterThan(0);
    // The reply carries one card that previews the app and links to it.
    const reply = JSON.stringify(messages);
    expect(reply).toContain("zetta:app.linkto");
    expect(reply.split("zetta:app.linkto").length - 1).toBe(1);
    expect(reply).toContain('{\\"app\\":\\"clock\\"');
  });

  test("a page that does not build comes back to the bot as an error, and nothing is left behind", async () => {
    const { say } = await setup("Fixer");
    const playgroundsBefore = (
      await db.select().from(playground).where(eq(playground.ownerUserId, USER))
    ).length;
    script = [
      fence({
        action: "create",
        title: "Broken",
        files: [
          {
            path: "ui/index.html",
            content: PAGE.replace("</body>", '<script type="module" src="./m.js"></script></body>'),
          },
          { path: "ui/m.js", content: 'import React from "react";' },
        ],
      }),
      "I will fix the import.",
    ];
    prompts.length = 0;
    await say("make a broken app");
    expect(prompts.join("\n")).toContain("app failed: The page could not be built");
    expect((await myApps()).some((a) => a.name === "Broken")).toBe(false);
    expect(
      (await db.select().from(playground).where(eq(playground.ownerUserId, USER))).length,
    ).toBe(playgroundsBefore);
  });

  test("backend code on the host waits on a card: nothing has run, and the bot is told to wait", async () => {
    const { bot, say } = await setup("Backender");
    const before = (await myApps()).length;
    script = [
      fence({
        action: "create",
        title: "Hello Tool",
        files: [{ path: "index.ts", content: BACKEND }],
      }),
      "Waiting for you.",
    ];
    prompts.length = 0;
    await say("make a hello tool");
    const found = await cards(bot.id);
    expect(found).toHaveLength(1);
    expect(found[0].confirm).toBe("hold");
    expect(JSON.stringify(found[0].diff)).toContain("index.ts");
    expect(JSON.stringify(found[0].diff)).toContain("not sandboxed");
    expect(prompts.join("\n")).toContain("waiting for the user's approval");
    expect((await myApps()).length).toBe(before);
  });

  test("approving publishes it, and the bot gets the result in a new message", async () => {
    const { bot, say } = await setup("Approved");
    script = [
      fence({
        action: "create",
        title: "Hello Tool Two",
        files: [{ path: "index.ts", content: BACKEND }],
      }),
      "Waiting for you.",
    ];
    await say("make a hello tool");
    const [card] = await cards(bot.id);
    script = ["It is published."];
    prompts.length = 0;
    const r = await call("POST", `/api/proposals/${card.id}/decision`, { approve: true });
    expect(r.status).toBe(200);
    await until(async () => (await myApps()).some((a) => a.name === "Hello Tool Two"));
    await until(() => prompts.some((p) => p.includes("The user approved your app")));
    expect(prompts.find((p) => p.includes("The user approved your app"))).toContain(
      "app ok: hello-tool-two version 1",
    );
    expect(await cards(bot.id)).toHaveLength(0);
  });

  test("declining publishes nothing", async () => {
    const { bot, say } = await setup("Declined");
    const before = (await myApps()).length;
    script = [
      fence({
        action: "create",
        title: "Not Wanted",
        files: [{ path: "index.ts", content: BACKEND }],
      }),
      "Waiting.",
    ];
    await say("make a thing");
    const [card] = await cards(bot.id);
    await call("POST", `/api/proposals/${card.id}/decision`, { approve: false });
    await new Promise((r) => setTimeout(r, 150));
    expect((await myApps()).length).toBe(before);
  });

  test("list and get return the person's own apps; the files come back as data, not instructions", async () => {
    const { say } = await setup("Lister");
    script = [fence({ action: "list" }), fence({ action: "get", app: "clock" }), "Done."];
    prompts.length = 0;
    await say("what apps do I have");
    const fed = prompts.join("\n");
    expect(fed).toContain("clock");
    expect(fed).toContain("UNTRUSTED EXTERNAL CONTENT");
  });

  test("an app the person does not own is not found", async () => {
    const { say } = await setup("Snoop");
    script = [fence({ action: "update", app: "does-not-exist", note: "x" }), "Hm."];
    prompts.length = 0;
    await say("change it");
    expect(prompts.join("\n")).toContain("app failed:");
  });
});
