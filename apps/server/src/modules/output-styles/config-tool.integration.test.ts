import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { parseTools } from "../chat/tools";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createOutputStyles } from "./service";

const block = (name: string, body: object) =>
  `\`\`\`zetta:${name}\n${JSON.stringify(body)}\n\`\`\``;
const BOT = "11111111-1111-4111-8111-111111111111";

describe("the zetta:config and create_bot blocks", () => {
  test("accept a built-in output style", () => {
    expect(
      parseTools(block("config", { botId: BOT, patch: { outputStyle: "concise" } })).calls,
    ).toEqual([{ kind: "config", args: { botId: BOT, patch: { outputStyle: "concise" } } }]);
    expect(
      parseTools(block("create_bot", { name: "Scribe", outputStyle: "learning" })).calls,
    ).toEqual([{ kind: "create_bot", args: { name: "Scribe", outputStyle: "learning" } }]);
  });

  test("drop a block that names a custom or unknown style, because a bot cannot choose a user's own style", () => {
    expect(
      parseTools(block("config", { botId: BOT, patch: { outputStyle: "custom" } })).calls,
    ).toEqual([]);
    expect(
      parseTools(block("config", { botId: BOT, patch: { outputStyle: "shouty" } })).calls,
    ).toEqual([]);
    expect(
      parseTools(block("config", { botId: BOT, patch: { outputStyleId: BOT } })).calls,
    ).toEqual([]);
    expect(
      parseTools(block("create_bot", { name: "Scribe", outputStyle: "custom" })).calls,
    ).toEqual([]);
  });
});

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`cfg-a-${uuidv7()}`];
const [A] = ids as [string];

suite("bots change their own output style through tool blocks against compose postgres", () => {
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
  const fakeRun = Object.assign(async () => ({ text: script.shift() ?? "done", stopped: false }), {
    stream: async function* () {
      yield script.shift() ?? "done";
    },
  });
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: createChatService(db, fakeRun as never) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": A,
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
      id: A,
      name: A,
      email: `${A}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  const say = async (botId: string, content: string) => {
    const c = (await call("POST", "/api/conversations", { botId })).json.conversation.id as string;
    return call("POST", `/api/conversations/${c}/messages`, { content });
  };
  const botNamed = async (name: string) =>
    (
      (await call("GET", "/api/bots")).json.bots as {
        name: string;
        outputStyle: string;
        outputStyleId: string | null;
      }[]
    ).find((b) => b.name === name)!;

  test("a config block sets a built-in style and the bot stops pointing at a custom one", async () => {
    const style = await createOutputStyles(db).create(A, {
      name: "Rhymer",
      description: "",
      body: "Rhyme.",
    });
    const { bot } = (
      await call("POST", "/api/bots", {
        name: "Tuner",
        outputStyle: "custom",
        outputStyleId: style.id,
      })
    ).json as {
      bot: { id: string };
    };
    expect(await botNamed("Tuner")).toMatchObject({
      outputStyle: "custom",
      outputStyleId: style.id,
    });

    script = [
      `Tuning myself.\n${block("config", { botId: bot.id, patch: { outputStyle: "concise" } })}`,
    ];
    await say(bot.id, "be terser");
    expect(await botNamed("Tuner")).toMatchObject({ outputStyle: "concise", outputStyleId: null });
  });

  test("a config block that names a custom style changes nothing", async () => {
    const { bot } = (await call("POST", "/api/bots", { name: "Steady", outputStyle: "learning" }))
      .json as {
      bot: { id: string };
    };
    script = [block("config", { botId: bot.id, patch: { outputStyle: "custom" } })];
    await say(bot.id, "go custom");
    expect(await botNamed("Steady")).toMatchObject({
      outputStyle: "learning",
      outputStyleId: null,
    });
  });

  test("the chief creates a bot with the style the user asked for", async () => {
    const found = (
      (await call("GET", "/api/bots")).json.bots as { id: string; kind: string; version: number }[]
    ).find((b) => b.kind === "chief")!;
    // A chief on the practice engine only guides setup; a real engine lets the scripted reply run.
    const chief = (
      await call("PATCH", `/api/bots/${found.id}`, {
        expectedVersion: found.version,
        patch: { harness: "codex" },
      })
    ).json.bot as { id: string };
    script = [
      `Creating it.\n${block("create_bot", { name: "Scribe", outputStyle: "explanatory" })}`,
    ];
    await say(chief.id, "make me a bot that explains its choices");
    expect(await botNamed("Scribe")).toMatchObject({
      outputStyle: "explanatory",
      outputStyleId: null,
    });
  });
});
