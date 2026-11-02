import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { and, eq } from "@zetta/db/query";
import { bot as botTable, conversation } from "@zetta/db/schema/chat";
import { botPeer } from "@zetta/db/schema/discussions";
import { attentionItem, botIntegration, mcpServer, routine } from "@zetta/db/schema/features";
import { inboundRoute } from "@zetta/db/schema/inbound";
import { team, teamMember } from "@zetta/db/schema/teams";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createRoutines } from "../features/routines";
import { createChatService } from "./service";
const fakeRun = Object.assign(
  async (t: { prompt: string }) => ({ text: `reply: ${t.prompt.slice(-40)}`, stopped: false }),
  {
    stream: async function* (t: { prompt: string }) {
      yield `reply: ${t.prompt.slice(-40)}`;
    },
  },
);

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`chat-a-${uuidv7()}`, `chat-b-${uuidv7()}`];

suite("chat against compose postgres", () => {
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
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: {
      access,
      chat: createChatService(
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
        {
          routines: createRoutines(db, (async () => ({ text: "" })) as never, async () => ({
            status: "done",
            output: "",
          })),
        },
      ),
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.handle(
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
  test("a new bot keeps the personality, instructions, harness and model it was created with", async () => {
    const input = {
      name: "Coder",
      description: "Writes code",
      visibility: "private",
      harness: "claude-code",
      model: "haiku",
      personality: "A pragmatic senior engineer.",
      instructions: "Keep diffs small.",
    };
    const res = await call(ids[0]!, "POST", "/api/bots", input);
    expect(res.status).toBe(201);
    const { bot } = (await res.json()) as {
      bot: {
        id: string;
        personality: string;
        instructions: string;
        model: string;
        visibility: string;
      };
    };
    expect(bot).toMatchObject({
      personality: input.personality,
      instructions: input.instructions,
      model: "haiku",
      visibility: "private",
    });
    const list = (await (await call(ids[0]!, "GET", "/api/bots")).json()) as {
      bots: { id: string; personality: string }[];
    };
    expect(list.bots.find((b) => b.id === bot.id)?.personality).toBe(input.personality);
  });
  test("a bot's model must be one its harness allows, on create and on update", async () => {
    expect(
      (await call(ids[0]!, "POST", "/api/bots", { name: "Odd", harness: "codex", model: "haiku" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(ids[0]!, "POST", "/api/bots", {
          name: "Offline",
          harness: "fixture",
          model: "haiku",
        })
      ).status,
    ).toBe(400);
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", {
        name: "Quick",
        harness: "claude-code",
        model: "haiku",
      })
    ).json()) as { bot: { id: string } };
    const harnessOnly = await call(ids[0]!, "PATCH", `/api/bots/${bot.id}`, {
      expectedVersion: 1,
      patch: { harness: "codex" },
    });
    expect(harnessOnly.status).toBe(400);
    expect(((await harnessOnly.json()) as { error: { code: string } }).error.code).toBe(
      "MODEL_NOT_ALLOWED",
    );
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/bots/${bot.id}`, {
          expectedVersion: 1,
          patch: { model: "gpt-5" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/bots/${bot.id}`, {
          expectedVersion: 1,
          patch: { harness: "codex", model: "gpt-5" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/bots/${bot.id}`, {
          expectedVersion: 2,
          patch: { model: null },
        })
      ).status,
    ).toBe(200);
  });
  test("team specialists are visible but only editable by the owner", async () => {
    const created = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Reviewer" })
    ).json()) as { bot: { id: string; version: number; canEdit: boolean } };
    expect(created.bot.canEdit).toBe(true); // onboarding keeps this object: its settings must stay editable
    const list = (await (await call(ids[1]!, "GET", "/api/bots")).json()) as {
      bots: { id: string; canEdit: boolean }[];
    };
    expect(list.bots.find((b) => b.id === created.bot.id)?.canEdit).toBe(false);
    expect(
      (
        await call(ids[1]!, "PATCH", `/api/bots/${created.bot.id}`, {
          expectedVersion: 1,
          patch: { name: "x" },
        })
      ).status,
    ).toBe(404);
    const renamed = await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, {
      expectedVersion: 1,
      patch: { name: "Reviewer 2" },
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { bot: { canEdit: boolean } }).bot.canEdit).toBe(true);
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, {
          expectedVersion: 1,
          patch: { name: "stale" },
        })
      ).status,
    ).toBe(404);
  });
  test("team specialists are visible but only editable by the owner", async () => {
    const created = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Reviewer" })
    ).json()) as { bot: { id: string; version: number } };
    const list = (await (await call(ids[1]!, "GET", "/api/bots")).json()) as {
      bots: { id: string; canEdit: boolean }[];
    };
    expect(list.bots.find((b) => b.id === created.bot.id)?.canEdit).toBe(false);
    expect(
      (
        await call(ids[1]!, "PATCH", `/api/bots/${created.bot.id}`, {
          expectedVersion: 1,
          patch: { name: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, {
          expectedVersion: 1,
          patch: { name: "Reviewer 2" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/bots/${created.bot.id}`, {
          expectedVersion: 1,
          patch: { name: "stale" },
        })
      ).status,
    ).toBe(404);
  });
  test("a conversation can be renamed, pinned and favorited only by its owner", async () => {
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Renamer" })
    ).json()) as { bot: { id: string } };
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId: bot.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    const res = await call(ids[0]!, "PATCH", `/api/conversations/${conv.id}`, {
      title: "Whatsapp messages",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { conversation: { title: string } }).conversation.title).toBe(
      "Whatsapp messages",
    );
    expect(
      (
        await call(ids[0]!, "PATCH", `/api/conversations/${conv.id}`, {
          pinned: true,
          favorite: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(ids[1]!, "PATCH", `/api/conversations/${conv.id}`, { title: "Nope" })).status,
    ).toBe(404);
  });
  test("a manual rename sticks: the first turn does not rename the chat again", async () => {
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Keeper" })
    ).json()) as { bot: { id: string } };
    const create = async () =>
      (
        (await (await call(ids[0]!, "POST", "/api/conversations", { botId: bot.id })).json()) as {
          conversation: { id: string };
        }
      ).conversation.id;
    const titleOf = async (id: string) =>
      (
        (await (await call(ids[0]!, "GET", `/api/conversations?botId=${bot.id}`)).json()) as {
          conversations: { id: string; title: string }[];
        }
      ).conversations.find((c) => c.id === id)!.title;
    const renamed = await create();
    await call(ids[0]!, "PATCH", `/api/conversations/${renamed}`, { title: "My name" });
    await (
      await call(ids[0]!, "POST", `/api/conversations/${renamed}/stream`, {
        content: "first message of the renamed chat",
      })
    ).text();
    expect(await titleOf(renamed)).toBe("My name");
    const untouched = await create();
    await (
      await call(ids[0]!, "POST", `/api/conversations/${untouched}/stream`, {
        content: "first message of the other chat",
      })
    ).text();
    expect(await titleOf(untouched)).toBe("first message of the other chat");
  });
  test("a thread can be archived, listed apart and restored, only by its owner", async () => {
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Archiver" })
    ).json()) as { bot: { id: string } };
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId: bot.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    const titles = async (qs: string) =>
      (
        (await (await call(ids[0]!, "GET", `/api/conversations?botId=${bot.id}${qs}`)).json()) as {
          conversations: { id: string }[];
        }
      ).conversations.map((c) => c.id);
    expect(await titles("")).toEqual([conv.id]);
    expect(
      (await call(ids[1]!, "PATCH", `/api/conversations/${conv.id}`, { archived: true })).status,
    ).toBe(404);
    const archived = await call(ids[0]!, "PATCH", `/api/conversations/${conv.id}`, {
      archived: true,
    });
    expect(archived.status).toBe(200);
    expect(
      ((await archived.json()) as { conversation: { archived: boolean } }).conversation.archived,
    ).toBe(true);
    expect(await titles("")).toEqual([]);
    expect(await titles("&archived=true")).toEqual([conv.id]);
    expect(
      (await call(ids[0]!, "PATCH", `/api/conversations/${conv.id}`, { archived: false })).status,
    ).toBe(200);
    expect(await titles("")).toEqual([conv.id]);
  });
  test("deleting a thread removes it and its messages, only for its owner", async () => {
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Deleter" })
    ).json()) as { bot: { id: string } };
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId: bot.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    await call(ids[0]!, "POST", `/api/conversations/${conv.id}/messages`, { content: "hello" });
    expect((await call(ids[1]!, "DELETE", `/api/conversations/${conv.id}`)).status).toBe(404);
    expect((await call(ids[0]!, "DELETE", `/api/conversations/${conv.id}`)).status).toBe(200);
    expect((await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages`)).status).toBe(404);
    const left = (
      (await (
        await call(ids[0]!, "GET", `/api/conversations?botId=${bot.id}&archived=true`)
      ).json()) as { conversations: unknown[] }
    ).conversations;
    expect(left).toEqual([]);
  });
  test("workspaces only group bots and never change access", async () => {
    const w = (
      (await (await call(ids[0]!, "POST", "/api/workspaces", { name: "Research" })).json()) as {
        workspace: { id: string };
      }
    ).workspace;
    const chiefBots = (
      (await (await call(ids[0]!, "GET", "/api/bots")).json()) as {
        bots: { id: string; kind: string }[];
      }
    ).bots;
    const chief = chiefBots.find((b) => b.kind === "chief")!;
    expect(
      (await call(ids[0]!, "POST", `/api/bots/${chief.id}/workspace`, { workspaceId: w.id }))
        .status,
    ).toBe(200);
    expect(
      (await call(ids[1]!, "POST", `/api/bots/${chief.id}/workspace`, { workspaceId: null }))
        .status,
    ).toBe(404);
    expect(
      (await call(ids[1]!, "POST", `/api/bots/${chief.id}/workspace`, { workspaceId: w.id }))
        .status,
    ).toBe(404);
    const after = (
      (await (await call(ids[0]!, "GET", "/api/bots")).json()) as { bots: { kind: string }[] }
    ).bots;
    expect(after.filter((b) => b.kind === "chief")).toHaveLength(1);
    expect(
      ((await (await call(ids[1]!, "GET", "/api/workspaces")).json()) as { workspaces: unknown[] })
        .workspaces,
    ).toHaveLength(0);
    // inner groups: parent must be the caller's own workspace
    const inner = await call(ids[0]!, "POST", "/api/workspaces", {
      name: "Papers",
      parentId: w.id,
    });
    expect(inner.status).toBe(201);
    expect(
      (
        (await (await call(ids[0]!, "GET", "/api/workspaces")).json()) as {
          workspaces: { parentId: string | null; name: string }[];
        }
      ).workspaces.find((x) => x.name === "Papers")?.parentId,
    ).toBe(w.id);
    expect(
      (await call(ids[1]!, "POST", "/api/workspaces", { name: "Sneaky", parentId: w.id })).status,
    ).toBe(404);
  });
  test("a new bot is ready at once, also for someone else, and editing it does not lock it", async () => {
    const { bot: b } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Ready at once", harness: "pi" })
    ).json()) as { bot: { id: string; version: number; onboarded: boolean } };
    expect(b.onboarded).toBe(true);
    const conv = (
      (await (await call(ids[1]!, "POST", "/api/conversations", { botId: b.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    expect(
      (await call(ids[1]!, "POST", `/api/conversations/${conv.id}/messages`, { content: "hi" }))
        .status,
    ).not.toBe(409);
    const edited = (await (
      await call(ids[0]!, "PATCH", `/api/bots/${b.id}`, {
        expectedVersion: b.version,
        patch: { personality: "terse" },
      })
    ).json()) as { bot: { onboarded: boolean } };
    expect(edited.bot.onboarded).toBe(true);
  });
  test("the chief without a real harness guides setup; messages paginate with reply counts", async () => {
    const chief = (
      (await (await call(ids[0]!, "GET", "/api/bots")).json()) as {
        bots: { id: string; kind: string }[];
      }
    ).bots.find((b) => b.kind === "chief")!;
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId: chief.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    const r = (await (
      await call(ids[0]!, "POST", `/api/conversations/${conv.id}/messages`, {
        content: "hello chief",
      })
    ).json()) as { assistant: { content: string }; user: { id: string } };
    expect(r.assistant.content).toContain("not connected to an AI tool yet");
    for (let i = 0; i < 5; i++)
      await call(ids[0]!, "POST", `/api/conversations/${conv.id}/messages`, {
        content: `m${i}`,
        parentMessageId: r.user.id,
      });
    const page = (
      (await (
        await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages?limit=4`)
      ).json()) as { messages: { seq: number; replyCount: number; hasMore: boolean }[] }
    ).messages;
    expect(page).toHaveLength(4);
    expect(page[0]!.hasMore).toBe(true);
    const older = (
      (await (
        await call(
          ids[0]!,
          "GET",
          `/api/conversations/${conv.id}/messages?limit=100&before=${page[0]!.seq}`,
        )
      ).json()) as { messages: { seq: number; replyCount: number }[] }
    ).messages;
    expect(older.every((m) => m.seq < page[0]!.seq)).toBe(true);
    const root = (
      (await (
        await call(ids[0]!, "GET", `/api/conversations/${conv.id}/messages?limit=500`)
      ).json()) as { messages: { id: string; replyCount: number }[] }
    ).messages.find((m) => m.id === r.user.id)!;
    expect(root.replyCount).toBeGreaterThanOrEqual(5);
  });
  test("deleting a specialist detaches everything it could use and keeps its chats; the chief cannot be deleted", async () => {
    const owner = ids[0]!;
    const make = async (name: string) =>
      (
        (await (await call(owner, "POST", "/api/bots", { name })).json()) as {
          bot: { id: string };
        }
      ).bot.id;
    const doomed = await make("Doomed");
    const peer = await make("Peer");
    const [server] = await db
      .insert(mcpServer)
      .values({
        ownerUserId: owner,
        name: "doomed-mcp",
        transport: "http",
        url: "https://mcp.example.invalid",
      })
      .returning();
    await db
      .insert(botIntegration)
      .values({ botId: doomed, ownerUserId: owner, serverId: server!.id });
    await db
      .insert(inboundRoute)
      .values({ ownerUserId: owner, botId: doomed, pluginId: "whatsapp" });
    const [t] = await db
      .insert(team)
      .values({ ownerUserId: owner, name: `Doomed team ${uuidv7().slice(-6)}` })
      .returning();
    await db.insert(teamMember).values({ teamId: t!.id, botId: doomed, kind: "chief" });
    await db.insert(botPeer).values({ ownerUserId: owner, botId: peer, peerBotId: doomed });
    const [r] = await db
      .insert(routine)
      .values({
        ownerUserId: owner,
        botId: doomed,
        title: "Daily",
        prompt: "hi",
        paused: false,
        status: "scheduled",
        nextRunAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    const chat = (
      (await (await call(owner, "POST", "/api/conversations", { botId: doomed })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    await db.update(botTable).set({ computerMode: "browser" }).where(eq(botTable.id, doomed));

    expect((await call(ids[1]!, "DELETE", `/api/bots/${doomed}`)).status).toBe(404);
    expect((await call(owner, "DELETE", `/api/bots/${doomed}`)).status).toBe(200);
    expect((await call(owner, "DELETE", `/api/bots/${doomed}`)).status).toBe(200); // repeatable

    const listed = (
      (await (await call(owner, "GET", "/api/bots")).json()) as { bots: { id: string }[] }
    ).bots.map((b) => b.id);
    expect(listed).not.toContain(doomed);
    expect(listed).toContain(peer);
    expect(
      await db.select().from(botIntegration).where(eq(botIntegration.botId, doomed)),
    ).toHaveLength(0);
    expect(await db.select().from(teamMember).where(eq(teamMember.botId, doomed))).toHaveLength(0);
    expect(await db.select().from(botPeer).where(eq(botPeer.peerBotId, doomed))).toHaveLength(0);
    expect(
      (await db.select().from(inboundRoute).where(eq(inboundRoute.botId, doomed)))[0]!.enabled,
    ).toBe(false);
    const [after] = await db.select().from(routine).where(eq(routine.id, r!.id));
    expect({ archived: after!.archived, paused: after!.paused, next: after!.nextRunAt }).toEqual({
      archived: true,
      paused: true,
      next: null,
    });
    expect((await db.select().from(botTable).where(eq(botTable.id, doomed)))[0]!.computerMode).toBe(
      "off",
    );
    expect(await db.select().from(conversation).where(eq(conversation.id, chat.id))).toHaveLength(
      1,
    );

    const chief = (
      (await (await call(owner, "GET", "/api/bots")).json()) as {
        bots: { id: string; kind: string }[];
      }
    ).bots.find((b) => b.kind === "chief");
    expect((await call(owner, "DELETE", `/api/bots/${chief!.id}`)).status).toBe(404);
    await db.delete(mcpServer).where(eq(mcpServer.id, server!.id));
  });
  test("workspaces can be renamed and deleted without touching bots, chats or access", async () => {
    const w = (
      (await (await call(ids[0]!, "POST", "/api/workspaces", { name: "Temp" })).json()) as {
        workspace: { id: string };
      }
    ).workspace;
    const inner = (
      (await (
        await call(ids[0]!, "POST", "/api/workspaces", { name: "TempInner", parentId: w.id })
      ).json()) as { workspace: { id: string } }
    ).workspace;
    const b = (
      (await (await call(ids[0]!, "POST", "/api/bots", { name: "InTemp" })).json()) as {
        bot: { id: string };
      }
    ).bot;
    await call(ids[0]!, "POST", `/api/bots/${b.id}/workspace`, { workspaceId: w.id });
    expect((await call(ids[1]!, "PATCH", `/api/workspaces/${w.id}`, { name: "Hack" })).status).toBe(
      404,
    );
    expect(
      (await call(ids[0]!, "PATCH", `/api/workspaces/${w.id}`, { name: "Renamed" })).status,
    ).toBe(200);
    expect((await call(ids[1]!, "DELETE", `/api/workspaces/${w.id}`)).status).toBe(404);
    expect((await call(ids[0]!, "DELETE", `/api/workspaces/${w.id}`)).status).toBe(200);
    const bots = (
      (await (await call(ids[0]!, "GET", "/api/bots")).json()) as {
        bots: { id: string; workspaceId: string | null }[];
      }
    ).bots;
    expect(bots.find((x) => x.id === b.id)!.workspaceId).toBeNull(); // moved up, still there
    const spaces = (
      (await (await call(ids[0]!, "GET", "/api/workspaces")).json()) as {
        workspaces: { id: string; parentId: string | null }[];
      }
    ).workspaces;
    expect(spaces.find((x) => x.id === inner.id)!.parentId).toBeNull();
    expect(spaces.some((x) => x.id === w.id)).toBe(false);
  });
  test("the AI SDK chat endpoint streams one assistant UI message and resumes only an active turn", async () => {
    const { bot: b } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "UI streamer", harness: "pi" })
    ).json()) as { bot: { id: string } };
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId: b.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation;
    expect(
      (await call(ids[1]!, "POST", `/api/conversations/${conv.id}/chat`, { content: "hi" })).status,
    ).toBe(404);
    const res = await call(ids[0]!, "POST", `/api/conversations/${conv.id}/chat`, {
      content: "hello ui",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const lines = (await res.text())
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6));
    expect(lines.at(-1)).toBe("[DONE]");
    const chunks = lines
      .slice(0, -1)
      .map((l) => JSON.parse(l) as { type: string; id?: string; delta?: string; data?: any });
    expect(chunks.map((c) => c.type)).toEqual([
      "start",
      "data-user-saved",
      "data-speaker",
      "text-start",
      "text-delta",
      "text-end",
      "data-saved",
      "finish",
    ]);
    const speaker = chunks.find((c) => c.type === "data-speaker")!;
    expect(speaker.data).toMatchObject({
      messageId: speaker.id,
      botId: b.id,
      botName: "UI streamer",
    });
    expect(chunks.find((c) => c.type === "data-user-saved")!.data.message).toMatchObject({
      role: "user",
      content: "hello ui",
    });
    const saved = chunks.find((c) => c.type === "data-saved")!.data;
    expect(saved).toMatchObject({
      botName: "UI streamer",
      message: { id: speaker.id, role: "assistant", status: "complete" },
    });
    expect(typeof saved.message.createdAt).toBe("string");
    expect(saved.message.seq).toBeNumber();
    expect(
      chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => c.delta)
        .join(""),
    ).toBe(saved.message.content);
    expect((await call(ids[0]!, "GET", `/api/conversations/${conv.id}/chat/stream`)).status).toBe(
      204,
    ); // turn finished
    expect((await call(ids[1]!, "GET", `/api/conversations/${conv.id}/chat/stream`)).status).toBe(
      404,
    );
  });
  test("no bot can be named like a mention of people: user, channel, here, all", async () => {
    for (const name of ["user", "User", "ALL", "He re", "channel"]) {
      const res = await call(ids[0]!, "POST", "/api/bots", { name });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "BOT_NAME_RESERVED",
      );
    }
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Usher" })
    ).json()) as { bot: { id: string } };
    const renamed = await call(ids[0]!, "PATCH", `/api/bots/${bot.id}`, {
      expectedVersion: 1,
      patch: { name: "all" },
    });
    expect(renamed.status).toBe(400);
    expect(((await renamed.json()) as { error: { code: string } }).error.code).toBe(
      "BOT_NAME_RESERVED",
    );
  });
  test("a bot reply that says @user raises one attention card that links to the chat", async () => {
    const { bot } = (await (
      await call(ids[0]!, "POST", "/api/bots", { name: "Caller" })
    ).json()) as { bot: { id: string } };
    const conv = (
      (await (await call(ids[0]!, "POST", "/api/conversations", { botId: bot.id })).json()) as {
        conversation: { id: string };
      }
    ).conversation.id;
    const cards = () =>
      db
        .select({ title: attentionItem.title, resultLink: attentionItem.resultLink })
        .from(attentionItem)
        .where(and(eq(attentionItem.ownerUserId, ids[0]!), eq(attentionItem.botId, bot.id)));
    await (
      await call(ids[0]!, "POST", `/api/conversations/${conv}/stream`, { content: "just hello" })
    ).text();
    expect(await cards()).toHaveLength(0);
    await (
      await call(ids[0]!, "POST", `/api/conversations/${conv}/stream`, { content: "@user ping" })
    ).text();
    const found = await cards();
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("Caller needs you");
    expect(found[0]!.resultLink).toBe(`/chat/${conv}`);
  });
});
