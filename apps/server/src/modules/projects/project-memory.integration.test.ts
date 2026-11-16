import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createTurnRunner } from "../chat/pipeline";
import { discussionPrompt } from "../discussions/prompt";
import { createIdentityAccess } from "../identity/access";
import { createMemory, MemoryError } from "../memory/service";
import { runMemoryTool } from "../memory/tool";
import { activeProjectsOf, memoryProjectsOf } from "./auto-join";
import { createProjectStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `pmem-a-${uuidv7()}`;
const B = `pmem-b-${uuidv7()}`;

suite("project memory and project context against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const projects = createProjectStore(db);
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
  const actorOf = (id: string) => access.requireActive(new Headers({ "x-test-user": id }));
  // on: a bot of the project. also: a second bot of the project. off: a bot of the same owner that is not on it.
  let on = "",
    also = "",
    off = "";
  let launch = "",
    other = "";
  let roomId = "";
  const newBot = async (name: string, harness = "fixture") =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          name,
          slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
          harness,
        } as never)
        .returning()
    )[0]!.id;
  const write = (botId: string, args: object, ctx: Parameters<typeof runMemoryTool>[5] = {}) =>
    runMemoryTool(
      memory,
      A,
      botId,
      undefined,
      { action: "write", title: "T", content: "Body text.", ...args } as never,
      ctx,
    );
  const slugs = async (botId: string | undefined, text: string) =>
    (await memory.search(botId ? { userId: A, botId } : A, text, 20)).map((h) => h.slug);

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [A, B].map((id) => ({
        id,
        name: id.slice(0, 6),
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(membership).values(
      [A, B].map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
    on = await newBot("On", "claude-code");
    also = await newBot("Also");
    off = await newBot("Off");
    const actor = await actorOf(A);
    launch = (
      await projects.create(actor, {
        name: "Spring launch",
        outcome: "A launch page",
        doneWhen: "It is live",
        bots: [on, also],
      })
    ).id;
    other = (await projects.create(actor, { name: "Other", bots: [off] })).id;
    const [conv] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: on, title: "Room", kind: "discussion" } as never)
      .returning();
    const [room] = await db
      .insert(discussion)
      .values({
        ownerUserId: A,
        conversationId: conv!.id,
        title: "Launch room",
        openKey: uuidv7(),
        projectId: launch,
      })
      .returning();
    roomId = room!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("a project item is read by the bots on the project and by the owner, and by no other bot", async () => {
    const r = await write(
      on,
      { slug: "launch-tone", title: "Launch tone", type: "project" },
      { onlyProjectId: launch },
    );
    expect(r.saved).toMatchObject({ slug: "launch-tone", created: true });
    const page = await memory.read(A, "launch-tone");
    expect(page?.page).toMatchObject({ type: "project", projects: [launch] });
    expect(await slugs(on, "launch tone")).toContain("launch-tone");
    expect(await slugs(also, "launch tone")).toContain("launch-tone");
    expect(await slugs(undefined, "launch tone")).toContain("launch-tone");
    expect(await slugs(off, "launch tone")).not.toContain("launch-tone");
    expect(await memory.read({ userId: A, botId: off }, "launch-tone")).toBeUndefined();
    // Another person's bots never see it.
    expect((await memory.search(B, "launch tone", 20)).map((h) => h.slug)).not.toContain(
      "launch-tone",
    );
  });

  test("a bot files an item only under a project it is on", async () => {
    // Off is on "Other" only: naming the launch project is refused, and so is a project of nobody.
    const refused = await write(off, { slug: "sneaky", type: "project", project: launch });
    expect(refused.saved).toBeUndefined();
    expect(refused.result).toContain("type project needs a project you are on");
    const nowhere = await write(also, { slug: "nowhere", type: "project", project: uuidv7() });
    expect(nowhere.saved).toBeUndefined();
    // With no project named and none known, there is nothing to file it under.
    expect((await write(also, { slug: "unnamed", type: "project" })).saved).toBeUndefined();
    // Off cannot take the slug of an item it cannot see, either.
    const taken = await write(off, { slug: "launch-tone", title: "Mine now" });
    expect(taken.result).toContain("already uses this slug");
    // A person files an item under their own projects only.
    await expect(
      memory.write(
        B,
        { slug: "theirs", title: "T", content: "x", type: "project", projects: [launch] },
        { by: "user" },
      ),
    ).rejects.toBeInstanceOf(MemoryError);
    const mine = await memory.write(
      A,
      {
        slug: "launch-dates",
        title: "Launch dates",
        content: "May.",
        type: "project",
        projects: [launch],
      },
      { by: "user" },
    );
    expect(mine.created).toBe(true);
    expect(await slugs(also, "launch dates")).toContain("launch-dates");
  });

  test("in a room of the project a new item is for the project; elsewhere the bot has to say so", async () => {
    expect(await memoryProjectsOf(db, A, on, roomId)).toEqual({
      projectId: launch,
      onlyProjectId: launch,
    });
    expect(await memoryProjectsOf(db, A, on)).toEqual({ projectId: null, onlyProjectId: launch });
    // Off is not on the room's project: nothing in that room is filed under it for this bot.
    expect(await memoryProjectsOf(db, A, off, roomId)).toEqual({
      projectId: null,
      onlyProjectId: other,
    });
    const inRoom = await write(
      on,
      { slug: "room-note" },
      await memoryProjectsOf(db, A, on, roomId),
    );
    expect(inRoom.saved?.created).toBe(true);
    expect((await memory.read(A, "room-note"))?.page.type).toBe("project");
    // In its own chat the same bot writes for all the owner's bots unless it asks for the project.
    const inChat = await write(on, { slug: "chat-note" }, await memoryProjectsOf(db, A, on));
    expect(inChat.saved?.created).toBe(true);
    expect((await memory.read(A, "chat-note"))?.page.type).toBe("owner");
    // Writing an existing item again keeps where it is filed.
    await write(
      on,
      { slug: "chat-note", content: "Changed." },
      await memoryProjectsOf(db, A, on, roomId),
    );
    expect((await memory.read(A, "chat-note"))?.page.type).toBe("owner");
  });

  test("the project's items can be listed, and a link never shows an item to a bot off the project", async () => {
    const listed = await memory.browse({ userId: A, botId: also }, { projectId: launch }, 10);
    expect(listed.map((h) => h.slug).sort()).toEqual(["launch-dates", "launch-tone", "room-note"]);
    expect(await memory.browse({ userId: A, botId: off }, { projectId: launch }, 10)).toEqual([]);
    await memory.write(
      A,
      { slug: "brand", title: "Brand", content: "See [[launch-tone]] for the launch." },
      { by: "user" },
    );
    const forOn = await memory.read({ userId: A, botId: on }, "brand");
    expect(forOn?.links.map((l) => l.slug)).toEqual(["launch-tone"]);
    const forOff = await memory.read({ userId: A, botId: off }, "brand");
    expect(forOff?.links.map((l) => l.slug) ?? []).not.toContain("launch-tone");
  });

  test("the project page lists its memory for the owner", async () => {
    const page = await projects.get(await actorOf(A), launch);
    expect(page.memory.total).toBe(3);
    expect(page.memory.items.map((n) => n.slug).sort()).toEqual([
      "launch-dates",
      "launch-tone",
      "room-note",
    ]);
    // An archived item is no longer part of it.
    await memory.setStatus(A, "room-note", "archived", { by: "user" });
    expect((await projects.get(await actorOf(A), launch)).memory.total).toBe(2);
  });

  test("leaving the project ends the access, and a paused project gives no context", async () => {
    const actor = await actorOf(A);
    await projects.setMembers(actor, launch, { bots: [on], people: [] });
    expect(await slugs(also, "launch tone")).not.toContain("launch-tone");
    await projects.setMembers(actor, launch, { bots: [on, also], people: [] });
    expect(await slugs(also, "launch tone")).toContain("launch-tone");
    expect((await activeProjectsOf(db, A, on)).map((p) => p.name)).toEqual(["Spring launch"]);
    await projects.update(actor, launch, { status: "paused" });
    expect(await activeProjectsOf(db, A, on)).toEqual([]);
    // The memory is still read while the project is on hold: only the context and the defaults stop.
    expect(await slugs(on, "launch tone")).toContain("launch-tone");
    await projects.update(actor, launch, { status: "active" });
  });

  test("a bot on a project reads its brief and its memory before it works; outside people never get it", async () => {
    const [row] = await db.select().from(bot).where(eq(bot.id, on));
    const seen: string[] = [];
    const runner = createTurnRunner(
      db,
      async (i) => {
        seen.push(i.prompt);
        return "ok";
      },
      undefined,
      memory,
    );
    await runner({ userId: A, bot: row!, history: [], prompt: "Write the headline" });
    expect(seen[0]).toContain("Projects you work on");
    expect(seen[0]).toContain("## Spring launch\nWhat should exist when it is done: A launch page");
    expect(seen[0]).toContain("How we know it is done: It is live");
    expect(seen[0]).toContain("- launch-tone — Launch tone");
    // The request still comes last, after the project.
    expect(seen[0]!.indexOf("Projects you work on")).toBeLessThan(
      seen[0]!.indexOf("User: Write the headline"),
    );
    await runner({ userId: A, bot: row!, history: [], prompt: "Write the headline", noCode: true });
    expect(seen[1]).not.toContain("Spring launch");
    // Another person who talks to the same bot gets none of the owner's projects.
    await runner({ userId: B, bot: row!, history: [], prompt: "Write the headline" });
    expect(seen[2]).not.toContain("Spring launch");
  });

  test("a room prompt names the room's project for a member that is not on it", () => {
    const prompt = discussionPrompt({
      you: { botId: off, name: "Off", role: "" } as never,
      title: "Launch room",
      goal: "Ship it",
      context: "",
      contextVersion: 1,
      members: [{ botId: off, name: "Off", role: "" } as never],
      creatorName: null,
      tainted: false,
      transcript: [],
      reason: "",
      nonce: "n1",
      project: {
        id: launch,
        name: "Spring launch",
        outcome: "A launch page",
        audience: "",
        doneWhen: "It is live",
        notIncluded: "",
      },
    });
    expect(prompt).toContain("This room works for a project");
    expect(prompt).toContain(
      "<<<PROJECT-n1\n## Spring launch\nWhat should exist when it is done: A launch page",
    );
  });
});
