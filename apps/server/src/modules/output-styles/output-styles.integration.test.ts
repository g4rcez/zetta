import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createOutputStyles } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`style-a-${uuidv7()}`, `style-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("output styles against compose postgres", () => {
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
  /** Every prompt the harness received, in order. */
  const prompts: string[] = [];
  const cli = async function* (opts: { prompt: string }) {
    prompts.push(opts.prompt);
    yield "ok";
  };
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: {
      access,
      chat: createChatService(db, createTurnRunner(db, (async () => "x") as never, cli as never)),
    },
    outputStyles: { access, styles: createOutputStyles(db) },
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
    const text = await r.text();
    return {
      status: r.status,
      text,
      headers: r.headers,
      json: (text ? safeJson(text) : {}) as any,
    };
  };
  const safeJson = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return {};
    }
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
    await cleanupTestUsers(db, ids);
  });

  const newBot = async (as: string, style: Record<string, unknown> = {}) => {
    const r = await call(as, "POST", "/api/bots", { name: "Voice", harness: "pi", ...style });
    return {
      status: r.status,
      bot: r.json.bot as { id: string; version: number; outputStyle: string },
    };
  };
  /** Sends one message and returns the prompt the harness got. */
  const promptOf = async (as: string, botId: string) => {
    const c = (await call(as, "POST", "/api/conversations", { botId })).json.conversation
      .id as string;
    const before = prompts.length;
    await call(as, "POST", `/api/conversations/${c}/stream`, { content: "go" });
    return prompts.slice(before).join("\n---\n");
  };
  const makeStyle = async (as: string, body = "Always answer in rhyme.") =>
    (
      await call(as, "POST", "/api/output-styles", {
        name: "Rhymer",
        description: "Speaks in rhyme",
        body,
      })
    ).json.style as {
      id: string;
      version: number;
    };

  test("a new bot has the Default style and adds nothing to the prompt", async () => {
    const { bot } = await newBot(A);
    expect(bot.outputStyle).toBe("default");
    expect(await promptOf(A, bot.id)).not.toContain("Output style");
  });

  test("a built-in style puts its text in the prompt", async () => {
    const { bot } = await newBot(A, { outputStyle: "concise", outputStyleId: null });
    const prompt = await promptOf(A, bot.id);
    expect(prompt).toContain("Output style (how to write every reply):");
    expect(prompt).toContain("Lead with the result or the answer.");
  });

  test("a new bot may name a built-in style without an id", async () => {
    const { bot, status } = await newBot(A, { outputStyle: "learning" });
    expect(status).toBe(201);
    expect(bot.outputStyle).toBe("learning");
  });

  test("custom needs a style id, and a built-in refuses one", async () => {
    const style = await makeStyle(A);
    expect((await newBot(A, { outputStyle: "custom", outputStyleId: null })).status).toBe(400);
    expect((await newBot(A, { outputStyle: "concise", outputStyleId: style.id })).status).toBe(400);
    expect((await newBot(A, { outputStyle: "custom" })).status).toBe(400);
  });

  test("another member cannot use a private style, then can use it once shared", async () => {
    const style = await makeStyle(A, "Speak like a pirate.");
    const denied = await newBot(B, { outputStyle: "custom", outputStyleId: style.id });
    expect(denied.status).toBe(400);
    expect((await call(B, "GET", "/api/output-styles")).json.styles).toHaveLength(0);

    await call(A, "PATCH", `/api/output-styles/${style.id}`, {
      expectedVersion: style.version,
      scope: "installation",
    });
    const listed = (await call(B, "GET", "/api/output-styles")).json.styles as {
      id: string;
      mine: boolean;
    }[];
    expect(listed.map((s) => [s.id, s.mine])).toEqual([[style.id, false]]);

    const { bot, status } = await newBot(B, { outputStyle: "custom", outputStyleId: style.id });
    expect(status).toBe(201);
    expect(await promptOf(B, bot.id)).toContain("Speak like a pirate.");
  });

  test("an edit reaches every bot that uses the style", async () => {
    const style = await makeStyle(A, "First wording.");
    await call(A, "PATCH", `/api/output-styles/${style.id}`, {
      expectedVersion: style.version,
      scope: "installation",
    });
    const { bot } = await newBot(B, { outputStyle: "custom", outputStyleId: style.id });
    expect(await promptOf(B, bot.id)).toContain("First wording.");

    await call(A, "PATCH", `/api/output-styles/${style.id}`, {
      expectedVersion: style.version + 1,
      body: "Second wording.",
    });
    const next = await promptOf(B, bot.id);
    expect(next).toContain("Second wording.");
    expect(next).not.toContain("First wording.");
  });

  test("archiving keeps the bots working; unsharing returns them to Default", async () => {
    const style = await makeStyle(A, "Keep it formal.");
    const shared = await call(A, "PATCH", `/api/output-styles/${style.id}`, {
      expectedVersion: style.version,
      scope: "installation",
    });
    const { bot } = await newBot(B, { outputStyle: "custom", outputStyleId: style.id });

    expect((await call(A, "DELETE", `/api/output-styles/${style.id}`)).status).toBe(200);
    expect(
      (await call(A, "GET", "/api/output-styles")).json.styles.map((s: { id: string }) => s.id),
    ).not.toContain(style.id);
    expect(await promptOf(B, bot.id)).toContain("Keep it formal.");
    expect(shared.json.style.scope).toBe("installation");

    const other = await makeStyle(A, "Only while shared.");
    await call(A, "PATCH", `/api/output-styles/${other.id}`, {
      expectedVersion: other.version,
      scope: "installation",
    });
    const mine = await newBot(B, { outputStyle: "custom", outputStyleId: other.id });
    await call(A, "PATCH", `/api/output-styles/${other.id}`, {
      expectedVersion: other.version + 1,
      scope: "private",
    });
    expect(await promptOf(B, mine.bot.id)).not.toContain("Only while shared.");
  });

  test("only the owner can edit or archive a shared style", async () => {
    const style = await makeStyle(A);
    await call(A, "PATCH", `/api/output-styles/${style.id}`, {
      expectedVersion: style.version,
      scope: "installation",
    });
    expect(
      (
        await call(B, "PATCH", `/api/output-styles/${style.id}`, {
          expectedVersion: style.version + 1,
          name: "Mine",
        })
      ).status,
    ).toBe(404);
    expect((await call(B, "DELETE", `/api/output-styles/${style.id}`)).status).toBe(404);
  });

  test("an edit from a stale version is refused", async () => {
    const style = await makeStyle(A);
    await call(A, "PATCH", `/api/output-styles/${style.id}`, {
      expectedVersion: style.version,
      name: "Renamed",
    });
    expect(
      (
        await call(A, "PATCH", `/api/output-styles/${style.id}`, {
          expectedVersion: style.version,
          name: "Again",
        })
      ).status,
    ).toBe(409);
  });

  test("a style that holds a secret is refused", async () => {
    const r = await call(A, "POST", "/api/output-styles", {
      name: "Leaky",
      body: "Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(r.status).toBe(400);
  });

  test("export gives a Claude Code style file, and import makes a private copy", async () => {
    const style = await makeStyle(A, "Be warm.");
    const file = await call(A, "GET", `/api/output-styles/${style.id}/export`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("text/markdown");
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="rhymer.md"');
    expect(file.text).toBe(
      '---\nname: "Rhymer"\ndescription: "Speaks in rhyme"\n---\n\nBe warm.\n',
    );

    const imported = await call(B, "POST", "/api/output-styles/import", { markdown: file.text });
    expect(imported.status).toBe(201);
    expect(imported.json.style).toMatchObject({
      name: "Rhymer",
      body: "Be warm.",
      scope: "private",
      mine: true,
    });
    expect(
      (await call(A, "GET", "/api/output-styles")).json.styles.map((s: { id: string }) => s.id),
    ).not.toContain(imported.json.style.id);
  });

  test("a built-in can be exported, Default cannot", async () => {
    const learning = await call(A, "GET", "/api/output-styles/builtin/learning/export");
    expect(learning.status).toBe(200);
    expect(learning.text).toContain('name: "Learning"');
    expect((await call(A, "GET", "/api/output-styles/builtin/default/export")).status).toBe(404);
  });

  test("a file without a name is refused", async () => {
    expect(
      (
        await call(A, "POST", "/api/output-styles/import", {
          markdown: "---\ndescription: x\n---\nBody",
        })
      ).status,
    ).toBe(400);
  });

  test("the list names the five built-ins in order", async () => {
    const { builtins } = (await call(A, "GET", "/api/output-styles")).json as {
      builtins: { key: string }[];
    };
    expect(builtins.map((b) => b.key)).toEqual([
      "default",
      "proactive",
      "concise",
      "explanatory",
      "learning",
    ]);
  });
});
