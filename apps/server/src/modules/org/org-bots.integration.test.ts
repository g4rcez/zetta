import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers, resetOrgChart } from "../../test-support/db-cleanup";
import { createLoopStore } from "../chat/loops";
import { createChatService } from "../chat/service";
import { createDiscussionStore } from "../discussions/store";
import { createIdentityAccess, createMembershipLookup } from "../identity/access";
import { createTaskStore } from "../tasks/store";
import { createOrgStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// A is the administrator, B a plain member
const ids = [`orgbot-a-${uuidv7()}`, `orgbot-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("the administrator's bots manage the company chart through approval cards", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const org = createOrgStore(db);
  // The real lookup: A is the administrator because the installation row says so.
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    createMembershipLookup(db),
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
  const tasks = createTaskStore(db);
  const discussions = createDiscussionStore(db, undefined, createLoopStore(db));
  let app: ReturnType<typeof createApp>;

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
  type Card = {
    id: string;
    kind: string;
    patch: { tool?: string; title: string };
    diff: unknown[];
  };
  const pending = async (as: string) =>
    (await call(as, "GET", "/api/proposals")).json.proposals as Card[];
  const approve = (as: string, id: string, remember?: "bot" | "chat") =>
    call(as, "POST", `/api/proposals/${id}/decision`, {
      approve: true,
      ...(remember && { remember }),
    });
  const reject = (as: string, id: string) =>
    call(as, "POST", `/api/proposals/${id}/decision`, { approve: false });

  /** One of the user's bots, on an engine that runs the scripted replies, with an open chat. */
  const botOf = async (as: string, name: string, patch: object = {}) => {
    const made = (await call(as, "POST", "/api/bots", { name })).json.bot as {
      id: string;
      version: number;
    };
    const done = (
      await call(as, "PATCH", `/api/bots/${made.id}`, {
        expectedVersion: made.version,
        patch: { harness: "codex", ...patch },
      })
    ).json.bot as { id: string };
    const c = (await call(as, "POST", "/api/conversations", { botId: done.id })).json.conversation
      .id as string;
    return {
      id: done.id,
      say: async (reply: string[], content: string) => {
        script = reply;
        prompts.length = 0;
        return (await call(as, "POST", `/api/conversations/${c}/messages`, { content })).json
          .assistant.content as string;
      },
    };
  };
  const chiefOf = async (as: string) => {
    const found = (
      (await call(as, "GET", "/api/bots")).json.bots as {
        id: string;
        kind: string;
        version: number;
      }[]
    ).find((b) => b.kind === "chief")!;
    const patched = (
      await call(as, "PATCH", `/api/bots/${found.id}`, {
        expectedVersion: found.version,
        patch: { harness: "codex" },
      })
    ).json.bot as { id: string };
    const c = (await call(as, "POST", "/api/conversations", { botId: patched.id })).json
      .conversation.id as string;
    return {
      id: patched.id,
      say: async (reply: string[], content: string) => {
        script = reply;
        prompts.length = 0;
        return (await call(as, "POST", `/api/conversations/${c}/messages`, { content })).json
          .assistant.content as string;
      },
    };
  };
  const titles = async () =>
    (await org.get({ userId: A, isAdmin: true } as never)).positions.map((p) => p.title);
  const fence = (body: string) => "```zetta:org\n" + body + "\n```";

  beforeAll(async () => {
    await resetOrgChart(db);
    const svc = createChatService(
      db,
      fakeRun as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { tasks, discussions, org },
    );
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat: svc },
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
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
    // A is the administrator of this throwaway installation.
    await db
      .insert(installationIdentity)
      .values({ id: 1, adminUserId: A, bootstrappedAt: now })
      .onConflictDoUpdate({ target: installationIdentity.id, set: { adminUserId: A } });
  });
  afterAll(async () => {
    await resetOrgChart(db);
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await cleanupTestUsers(db, ids);
  });

  test("the administrator's specialist reads the chart, then a change waits for a card that is applied as the administrator", async () => {
    const helper = await botOf(A, "Planner");
    const reply = await helper.say(
      [fence('{"action":"list"}'), fence('{"action":"add_seat","template":"ceo"}')],
      "start the company chart",
    );
    expect(prompts.join("\n")).toContain("org.list (version 0)");
    expect(reply).toContain("Proposed: Add the seat CEO");
    expect(await titles()).toEqual([]);
    const [card] = await pending(A);
    expect(card).toMatchObject({ kind: "chief_action", patch: { tool: "org" } });
    expect((await approve(A, card!.id)).json.status).toBe("approved");
    expect(await titles()).toEqual(["CEO"]);
  });

  test("a change asked for after outside content still waits for a card, and an org card is never remembered", async () => {
    const helper = await botOf(A, "Cautious");
    await helper.say(
      [
        '```zetta:memory\n{"action":"search","query":"anything"}\n```',
        fence('{"action":"add_seat","under":"CEO","template":"cto"}'),
      ],
      "look something up, then add a CTO",
    );
    const [card] = await pending(A);
    expect(card).toMatchObject({ kind: "chief_action", patch: { tool: "org" } });
    expect(await titles()).toEqual(["CEO"]);
    // "Always allow" saves nothing for a company chart change, and the next one asks again.
    expect((await approve(A, card!.id, "bot")).json.status).toBe("approved");
    expect(await titles()).toEqual(["CEO", "CTO"]);
    const rules = (await call(A, "GET", `/api/bots/${helper.id}/approval-rules`)).json.rules;
    expect(rules).toEqual([]);
    await helper.say([fence('{"action":"add_seat","under":"CEO","template":"cfo"}')], "add a CFO");
    const [again] = await pending(A);
    expect(again).toMatchObject({ kind: "chief_action", patch: { tool: "org" } });
    await reject(A, again!.id);
    expect(await titles()).toEqual(["CEO", "CTO"]);
  });

  test("an administrator's bot can edit, move and reorder; the card says what changes", async () => {
    const helper = await botOf(A, "Editor");
    await helper.say(
      [fence('{"action":"update","seat":"CTO","title":"Head of technology","unit":"Tech"}')],
      "rename the CTO",
    );
    const [card] = await pending(A);
    expect(card!.patch.title).toBe("Change the seat CTO");
    await approve(A, card!.id);
    expect(await titles()).toEqual(["CEO", "Head of technology"]);
  });

  test("the chief of the administrator uses it too", async () => {
    const chief = await chiefOf(A);
    await chief.say([fence('{"action":"list"}')], "show the chart");
    expect(prompts.join("\n")).toContain("org.list");
    expect(await pending(A)).toEqual([]);
  });

  test("a member who is not the administrator is refused, with their own bot and with a shared one", async () => {
    const mine = await botOf(B, "Mine");
    await mine.say([fence('{"action":"list"}')], "show the chart");
    expect(prompts.join("\n")).toContain(
      "only the administrator's own bots can use the company chart",
    );
    expect(await pending(B)).toEqual([]);
    await mine.say([fence('{"action":"add_seat","under":"CEO","template":"cfo"}')], "add a CFO");
    expect(await pending(B)).toEqual([]);

    // The administrator's bot, shared with the team, run by B: B is not the administrator and does not own it.
    const shared = await botOf(A, "Shared", { visibility: "team" });
    const [row] = await db.select().from(bot).where(eq(bot.id, shared.id));
    const c = (await call(B, "POST", "/api/conversations", { botId: row!.id })).json.conversation
      .id as string;
    script = [fence('{"action":"add_seat","under":"CEO","template":"cfo"}')];
    prompts.length = 0;
    await call(B, "POST", `/api/conversations/${c}/messages`, { content: "add a CFO" });
    expect(prompts.join("\n")).toContain(
      "only the administrator's own bots can use the company chart",
    );
    expect(await pending(B)).toEqual([]);
    expect(await pending(A)).toEqual([]);
  });
});
