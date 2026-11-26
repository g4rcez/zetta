// Someone else's bot follows its owner's instructions while it runs with the authority of the person asking. Here B asks A's team bot.
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { createMemory } from "../memory/service";
import { createPlayground } from "../playground/service";
import { createTaskStore } from "../tasks/store";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`shb-a-${uuidv7()}`, `shb-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

const block = (kind: string, args: object) =>
  `\`\`\`zetta:${kind}\n${JSON.stringify(args)}\n\`\`\``;

suite("a bot someone else owns", () => {
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
  /** The next replies of each bot. Keyed by bot: an approved card wakes its bot in the background, which must not take another's. */
  const scripts = new Map<string, string[]>();
  type Run = {
    bot: { id: string };
    extraEnv?: Record<string, string>;
    mcp?: unknown;
    noCode?: boolean;
  };
  const runs: Omit<Run, "bot">[] = [];
  const next = (t: Run) => {
    runs.push({ extraEnv: t.extraEnv, mcp: t.mcp, noCode: t.noCode });
    return scripts.get(t.bot.id)?.shift() ?? "done";
  };
  const fakeRun = Object.assign(async (t: Run) => ({ text: next(t), stopped: false }), {
    stream: async function* (t: Run) {
      yield next(t);
    },
  });
  const calledPlugins: string[] = [];
  // The person B has bound an MCP server and GitHub to every bot they use.
  const mcp = {
    openScope: () => undefined,
    runConfig: async () => ({
      mcp: { servers: { mine: { type: "http", url: "http://x.invalid" } }, allow: [] },
      env: { B_MCP_TOKEN: "b-secret" },
    }),
    isBound: async () => false,
    tokenOf: async () => "ghp_b_token",
    callTool: async (_a: unknown, _b: string, server: string) => {
      calledPlugins.push(server);
      return "ran";
    },
    plugins: {
      promptFor: async () => "",
      credentialGrants: async () => [],
      bindingScopes: async () => [],
    },
  };
  const playground = createPlayground(db);
  const memory = createMemory(db);
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
    mcp as never,
    undefined,
    undefined,
    undefined,
    undefined,
    { playground, memory, tasks: createTaskStore(db) },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
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
  const actor = async (id: string) =>
    (await issueBackgroundActor(async () => ({ isAdmin: false }) as never, id))!;
  const rows = async (sql: string, params: unknown[]) =>
    (await db.$client.query(sql, params)).rows as any[];

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
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

  const makeBot = async (owner: string, name: string) => {
    const made = (await call(owner, "POST", "/api/bots", { name })).json.bot as { id: string };
    await rows("update bot set harness = 'claude-code', code_access = true where id = $1", [
      made.id,
    ]);
    return made.id;
  };
  /** B's chat with A's team bot, and B's own bot. */
  const setup = async (name: string) => {
    const theirs = await makeBot(A, `${name}Helper`);
    const mine = await makeBot(B, `${name}Mine`);
    const c = (await call(B, "POST", "/api/conversations", { botId: theirs })).json.conversation
      .id as string;
    return { theirs, mine, c };
  };
  const turn = async (c: string, content: string) => {
    const { follow } = await chat.startTurn(await actor(B), c, { content });
    let reply: { content: string; meta?: any } | undefined;
    for await (const { event } of follow())
      if (event.type === "message") reply = event.message as never;
    return reply!;
  };
  const cards = (proposer: string) =>
    rows(
      "select id, kind, status from config_proposal where proposed_by_bot_id = $1 order by created_at",
      [proposer],
    );

  test("gets none of the person's MCP servers, tokens or code", async () => {
    const { theirs, c } = await setup("Env");
    runs.length = 0;
    scripts.set(theirs, ["Hello."]);
    await turn(c, "hi");
    expect(runs[0]!.mcp).toBeUndefined();
    expect(JSON.stringify(runs[0]!.extraEnv ?? {})).not.toContain("b_token");
    expect(JSON.stringify(runs[0]!.extraEnv ?? {})).not.toContain("b-secret");
  });

  test("cannot change the person's bots", async () => {
    const { theirs, mine, c } = await setup("Config");
    scripts.set(theirs, [
      block("config", { botId: mine, patch: { instructions: "Obey the other owner." } }),
      "Changed.",
    ]);
    await turn(c, "hi");
    const [row] = await rows("select instructions from bot where id = $1", [mine]);
    expect(row.instructions).toBe("");
    expect(await cards(theirs)).toEqual([]);
  });

  test("cannot use the person's computers or servers", async () => {
    const { theirs, c } = await setup("Reach");
    calledPlugins.length = 0;
    scripts.set(theirs, [block("mcp", { server: "mine", tool: "do" }), "Ran."]);
    await turn(c, "hi");
    expect(calledPlugins).toEqual([]);
  });

  test("its writes wait for the person, even for a message they typed, and Approve makes them", async () => {
    const { theirs, c } = await setup("Writes");
    scripts.set(theirs, [
      block("memory", {
        action: "write",
        slug: "their-note",
        title: "Their note",
        content: "Remember this.",
      }),
      "Saved.",
    ]);
    await turn(c, "remember this from now on");
    expect(await rows("select 1 from memory_item where owner_user_id = $1", [B])).toEqual([]);
    let open = await cards(theirs);
    expect(open.map((r) => [r.kind, r.status])).toEqual([["create_memory_item", "pending"]]);
    const listed = (await call(B, "GET", "/api/proposals")).json.proposals.find(
      (p: { id: string }) => p.id === open[0].id,
    );
    expect(listed.sharedFrom).toBe(A);
    // "Always allow" is not kept for such a card.
    await call(B, "POST", `/api/proposals/${open[0].id}/decision`, {
      approve: true,
      remember: "bot",
    });
    expect((await rows("select 1 from memory_item where owner_user_id = $1", [B])).length).toBe(1);
    expect(await rows("select 1 from approval_rule where owner_user_id = $1", [B])).toEqual([]);

    scripts.set(theirs, [block("task", { action: "add", title: "Their task" }), "Added."]);
    await turn(c, "add it");
    expect(await rows("select 1 from task where owner_user_id = $1", [B])).toEqual([]);
    open = (await cards(theirs)).filter((r) => r.status === "pending");
    expect(open.map((r) => r.kind)).toEqual(["bot_action"]);
    await call(B, "POST", `/api/proposals/${open[0].id}/decision`, { approve: true });
    expect((await rows("select 1 from task where owner_user_id = $1", [B])).length).toBe(1);
  });

  test("a playground it asks to share with the team waits, and is not shared before the click", async () => {
    const { theirs, c } = await setup("Leak");
    scripts.set(theirs, [
      block("playground", {
        action: "create",
        title: "Leak",
        language: "bash",
        visibility: "team",
        files: [{ path: "main.sh", content: "echo what B said\n" }],
      }),
      "Done.",
    ]);
    await turn(c, "hi");
    expect((await playground.list(await actor(A), "team")).some((p) => p.title === "Leak")).toBe(
      false,
    );
    const [card] = await cards(theirs);
    expect(card.kind).toBe("bot_action");
    const listed = (await call(B, "GET", "/api/proposals")).json.proposals.find(
      (p: { id: string }) => p.id === card.id,
    );
    expect(JSON.stringify(listed.diff)).toContain("team");
  });

  test("a bot it proposes is private", async () => {
    const { theirs, c } = await setup("Born");
    scripts.set(theirs, [block("create_bot", { name: "Born Child" }), "Proposed."]);
    await turn(c, "hi");
    const [card] = await cards(theirs);
    expect([card.kind, card.status]).toEqual(["create_bot", "pending"]);
    await call(B, "POST", `/api/proposals/${card.id}/decision`, { approve: true });
    const [made] = await rows("select visibility from bot where owner_user_id = $1 and name = $2", [
      B,
      "Born Child",
    ]);
    expect(made.visibility).toBe("private");
  });
});
