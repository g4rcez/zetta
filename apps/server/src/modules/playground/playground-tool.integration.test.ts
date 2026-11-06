import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createPlayground } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`pgt-a-${uuidv7()}`];
const [A] = ids as [string];

const block = (args: object) => "```zetta:playground\n" + JSON.stringify(args) + "\n```";

suite("playground tool for bots", () => {
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
  const playground = createPlayground(db);
  const chat = createChatService(
    db,
    fakeRun as never,
    undefined,
    { epochOf: () => 0 } as never,
    {
      status: () => ({ state: "ready", model: "laya" }),
      warm: async () => {},
      close: async () => {},
    } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { playground },
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
          "x-test-user": A,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const actor = async () =>
    (await issueBackgroundActor(async () => ({ isAdmin: false }) as never, A))!;

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

  /** A bot and a chat with it. `code` gives it code access, which a run on the server needs. */
  const setup = async (name: string, code: boolean) => {
    const bot = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    if (code)
      await db.$client.query(
        "update bot set harness = 'claude-code', code_access = true where id = $1",
        [bot.id],
      );
    const c = (await call("POST", "/api/conversations", { botId: bot.id })).json.conversation
      .id as string;
    return { bot, c };
  };
  const turn = async (c: string, content: string, options: { untrusted?: boolean } = {}) => {
    const { follow } = await chat.startTurn(await actor(), c, { content, ...options });
    let reply: { content: string; meta?: any } | undefined;
    for await (const { event } of follow())
      if (event.type === "message") reply = event.message as never;
    return reply!;
  };

  test("a bot makes a playground, runs it and links it in the chat", async () => {
    const { bot, c } = await setup("Reporter", true);
    const made = await playground.create(await actor(), {
      title: "Report",
      language: "bash",
      files: [
        {
          path: "main.sh",
          content:
            'echo "month $ZETTA_INPUTS"\nmkdir -p out\necho "<h1>done</h1>" > out/report.html\n',
        },
      ],
      inputs: [{ name: "month", type: "string", default: "2026-10" }],
    });
    script = [block({ action: "run", id: made.id, inputs: { month: "2026-11" } }), "Ran it."];
    const reply = await turn(c, "Run the report for November");

    expect(reply.meta.receipts).toEqual([
      { kind: "playground", id: made.id, text: "Report", created: false },
    ]);
    const [run] = await playground.runs(await actor(), made.id);
    expect(run).toMatchObject({
      status: "ok",
      botId: bot.id,
      inputs: { month: "2026-11" },
      exitCode: 0,
    });
    // The bot was told what the run printed, framed as untrusted data.
    expect(prompts.at(-1)).toContain("UNTRUSTED EXTERNAL CONTENT");
    expect(prompts.at(-1)).toContain('month {"month":"2026-11"}');
    expect(prompts.at(-1)).toContain("report.html");
  });

  test("a bot creates a playground that remembers where it was made", async () => {
    const { bot, c } = await setup("Maker", true);
    script = [
      block({
        action: "create",
        title: "From a bot",
        language: "python",
        files: [{ path: "main.py", content: "print(1)\n" }],
      }),
      "Created.",
    ];
    const reply = await turn(c, "Make a script");

    const [receipt] = reply.meta.receipts;
    expect(receipt).toMatchObject({ kind: "playground", text: "From a bot", created: true });
    const row = await playground.get(await actor(), receipt.id);
    expect(row).toMatchObject({
      title: "From a bot",
      language: "python",
      runner: "host",
      visibility: "private",
      createdByBotId: bot.id,
    });
  });

  test("a bot without code access cannot run code on the server", async () => {
    const { c } = await setup("Chatty", false);
    const made = await playground.create(await actor(), {
      title: "No run",
      language: "bash",
      files: [{ path: "main.sh", content: "echo should not run\n" }],
    });
    script = [block({ action: "run", id: made.id }), "I could not."];
    await turn(c, "Run it");

    expect(await playground.runs(await actor(), made.id)).toEqual([]);
    expect(prompts.at(-1)).toContain("no code access");
  });

  test("after outside content a bot cannot create code without the user's approval, and Approve makes it", async () => {
    const { bot, c } = await setup("Reader", true);
    const before = (await playground.list(await actor(), "mine")).length;
    script = [
      block({
        action: "create",
        title: "Held",
        language: "bash",
        files: [{ path: "main.sh", content: "echo hi\n" }],
      }),
      "Waiting.",
    ];
    await turn(c, "Summarize this page", { untrusted: true });

    expect((await playground.list(await actor(), "mine")).length).toBe(before);
    const cards = await db.$client.query(
      "select id, kind, status from config_proposal where proposed_by_bot_id = $1",
      [bot.id],
    );
    expect(cards.rows.map((r) => [r.kind, r.status])).toEqual([["bot_action", "pending"]]);

    await call("POST", `/api/proposals/${cards.rows[0].id}/decision`, { approve: true });
    const after = await playground.list(await actor(), "mine");
    expect(after.length).toBe(before + 1);
    expect(after.some((p) => p.title === "Held")).toBe(true);
  });

  test("a bot reads a playground and its last run", async () => {
    const { c } = await setup("Reader2", true);
    const made = await playground.create(await actor(), {
      title: "Readable",
      language: "bash",
      files: [{ path: "main.sh", content: "echo first line\n" }],
    });
    await (
      await playground.run(await actor(), made.id)
    ).done;
    script = [block({ action: "get", id: made.id }), "Read it."];
    await turn(c, "What does it do?");

    expect(prompts.at(-1)).toContain("echo first line");
    expect(prompts.at(-1)).toContain("=== stdout of the run\nfirst line");
  });
});
