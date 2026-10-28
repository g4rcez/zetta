import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createFileStore } from "./files";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`exp-a-${uuidv7()}`, `exp-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("chat experience against compose postgres", () => {
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
  let root: string;
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
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zetta-files-"));
    await mkdir(join(root, "me", A), { recursive: true });
    await mkdir(join(root, "me", B), { recursive: true });
    await mkdir(join(root, "shared"), { recursive: true });
    await writeFile(join(root, "me", A, "notes.md"), "SECRET-A-NOTES");
    await writeFile(join(root, "shared", "team.md"), "TEAM-DOC");
    await writeFile(join(root, "me", B, "b.md"), "SECRET-B");
    await symlink(join(root, "me", B), join(root, "me", A, "escape")); // symlink into another user's area
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: {
        access,
        chat: createChatService(db, undefined, createFileStore(root)),
        files: createFileStore(root),
      },
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
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });
  const newBot = async (as: string, name: string, ready = true) => {
    const bot = (await call(as, "POST", "/api/bots", { name })).json.bot as {
      id: string;
      version: number;
    };
    if (ready) await db.$client.query("update bot set onboarded = true where id = $1", [bot.id]);
    return bot;
  };
  const conv = async (as: string, botId: string) =>
    (await call(as, "POST", "/api/conversations", { botId })).json.conversation.id as string;

  test("streams events in order over SSE and persists the final message", async () => {
    const bot = await newBot(A, "Streamer", false);
    const c = await conv(A, bot.id);
    const res = await app.handle(
      new Request(`http://localhost/api/conversations/${c}/stream`, {
        method: "POST",
        headers: {
          "x-test-user": A,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: "stream me please" }),
      }),
    );
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const events = (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((l) =>
        JSON.parse(
          l
            .split("\n")
            .find((x) => x.startsWith("data: "))!
            .slice(6),
        ),
      );
    expect(events[0].type).toBe("user");
    expect(events.some((e) => e.type === "start")).toBe(true);
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(1);
    expect(events.at(-1).type).toBe("done");
    const saved = events.find((e) => e.type === "message").message.content as string;
    expect(
      events
        .filter((e) => e.type === "delta")
        .map((e) => e.text)
        .join(""),
    ).toBe(saved);
    expect((await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages).toHaveLength(
      2,
    );
    // errors before streaming are plain JSON
    const denied = await app.handle(
      new Request(`http://localhost/api/conversations/${c}/stream`, {
        method: "POST",
        headers: {
          "x-test-user": B,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: "hi" }),
      }),
    );
    expect(denied.status).toBe(404);
  });

  test("attachments are owner-only, single-use and reach the bot", async () => {
    const bot = await newBot(A, "Reader", false);
    const c = await conv(A, bot.id);
    const up = await call(A, "POST", "/api/attachments", {
      name: "report.txt",
      text: "ATTACHED-CONTENT-42",
    });
    expect(up.status).toBe(201);
    expect((await call(A, "POST", "/api/attachments", { name: "bin", text: "a\0b" })).status).toBe(
      400,
    );
    expect(
      (
        await call(B, "POST", `/api/conversations/${c}/messages`, {
          content: "x",
          attachmentIds: [up.json.attachment.id],
        })
      ).status,
    ).toBe(404);
    const sent = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "read it",
      attachmentIds: [up.json.attachment.id],
    });
    expect(sent.json.assistant.content).toContain("ATTACHED-CONTENT-42");
    expect(sent.json.user.content).toBe("read it"); // stored message does not inline the file
    expect(
      (
        await call(A, "POST", `/api/conversations/${c}/messages`, {
          content: "again",
          attachmentIds: [up.json.attachment.id],
        })
      ).status,
    ).toBe(404); // already used
    const list = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages;
    expect(list[0].attachments[0].name).toBe("report.txt");
  });

  test("images are checked by content, served to their owner only, and survive as an image-only message", async () => {
    process.env.ZETTA_ATTACHMENTS_ROOT = await mkdtemp(join(tmpdir(), "zetta-att-"));
    const bot = await newBot(A, "Viewer", false);
    const c = await conv(A, bot.id);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const body = (bytes: Buffer, mimeType = "image/png") => ({
      name: "shot.png",
      mimeType,
      dataBase64: bytes.toString("base64"),
    });
    expect(
      (await call(A, "POST", "/api/attachments", body(Buffer.from("<svg onload=x>"), "image/png")))
        .status,
    ).toBe(400); // not really a png
    expect((await call(A, "POST", "/api/attachments", body(png, "image/svg+xml"))).status).toBe(
      400,
    );
    const up = await call(A, "POST", "/api/attachments", body(png));
    expect(up.status).toBe(201);
    expect(up.json.attachment.mimeType).toBe("image/png");
    const id = up.json.attachment.id as string;
    const get = (as: string) =>
      app.handle(
        new Request(`http://localhost/api/attachments/${id}/content`, {
          headers: { "x-test-user": as },
        }),
      );
    const mine = await get(A);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect(mine.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await mine.arrayBuffer()).equals(png)).toBe(true);
    expect((await get(B)).status).toBe(404);
    expect(
      (
        await call(A, "POST", `/api/conversations/${c}/messages`, {
          content: "",
          attachmentIds: [],
        })
      ).status,
    ).toBe(400); // empty is still empty
    const sent = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "",
      attachmentIds: [id],
    });
    expect(sent.status).toBeLessThan(300);
    const list = (await call(A, "GET", `/api/conversations/${c}/messages`)).json.messages;
    expect(list[0].attachments[0]).toMatchObject({ id, name: "shot.png", mimeType: "image/png" });
    expect((await get(A)).status).toBe(200); // still there after it was sent
  });

  test("a message with a picture can still be saved to memory, as text only", async () => {
    process.env.ZETTA_ATTACHMENTS_ROOT = await mkdtemp(join(tmpdir(), "zetta-att-"));
    const bot = await newBot(A, "Archivist", false);
    const c = await conv(A, bot.id);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9, 9, 9, 9, 9,
    ]);
    const up = await call(A, "POST", "/api/attachments", {
      name: "badge.png",
      mimeType: "image/png",
      dataBase64: png.toString("base64"),
    });
    const sent = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "remember that my badge number is 4242",
      attachmentIds: [up.json.attachment.id],
    });
    expect(sent.status).toBeLessThan(300);
    const rows = (
      await db.$client.query(
        "select content from memory where bot_id = $1 and owner_user_id = $2",
        [bot.id, A],
      )
    ).rows as { content: string }[];
    expect(rows.map((r) => r.content)).toContain("my badge number is 4242");
    expect(rows.some((r) => /badge\.png|image/i.test(r.content))).toBe(false);
  });

  test("server file references stay inside the user's area and the shared area", async () => {
    const bot = await newBot(A, "Filer", false);
    const c = await conv(A, bot.id);
    const ok = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "summarise",
      fileRefs: ["me/notes.md", "shared/team.md"],
    });
    expect(ok.json.assistant.content).toContain("SECRET-A-NOTES");
    expect(ok.json.assistant.content).toContain("TEAM-DOC");
    for (const bad of [
      "me/../" + B + "/b.md",
      `me/escape/b.md`,
      "../etc/passwd",
      "me/missing.md",
      "other/x",
    ])
      expect(
        (
          await call(A, "POST", `/api/conversations/${c}/messages`, {
            content: "x",
            fileRefs: [bad],
          })
        ).status,
      ).toBe(404);
    const cb = await conv(B, (await newBot(B, "BFiler", false)).id);
    expect(
      (
        await call(B, "POST", `/api/conversations/${cb}/messages`, {
          content: "x",
          fileRefs: ["me/notes.md"],
        })
      ).status,
    ).toBe(404); // B has no me/notes.md
    expect(
      (await call(A, "GET", "/api/files?path=shared")).json.entries.map(
        (e: { name: string }) => e.name,
      ),
    ).toContain("team.md");
  });

  test("@mentions delegate to ready visible bots (bounded) and failures raise attention", async () => {
    const chief = await newBot(A, "Lead", false);
    const spec = await newBot(A, "Analyst");
    const unready = await newBot(A, "Rookie", false);
    const c = await conv(A, chief.id);
    const r = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "@Analyst @Rookie @Nobody please look",
    });
    expect(r.json.replies).toHaveLength(2); // chat bot + Analyst only
    expect(r.json.replies[1].botId).toBe(spec.id);
    expect(r.json.replies.map((m: { botId: string }) => m.botId)).not.toContain(unready.id);
    // B cannot be reached through A's private bots; team bots owned by A are visible to B
    const cb = await conv(B, (await newBot(B, "Mine", false)).id);
    const viaTeam = await call(B, "POST", `/api/conversations/${cb}/messages`, {
      content: "@Analyst hi",
    });
    expect(viaTeam.json.replies).toHaveLength(2);
  });

  test("attachments can be deleted before sending; file refs deny credential files and record a content hash", async () => {
    const bot = await newBot(A, "Careful", false);
    const c = await conv(A, bot.id);
    const up = await call(A, "POST", "/api/attachments", {
      name: "../../etc/x.txt",
      text: "hello",
    });
    expect(up.json.attachment.name).not.toContain("/");
    expect(up.json.attachment.sha256).toHaveLength(64);
    expect((await call(B, "DELETE", `/api/attachments/${up.json.attachment.id}`)).status).toBe(404);
    expect((await call(A, "DELETE", `/api/attachments/${up.json.attachment.id}`)).status).toBe(200);
    expect(
      (
        await call(A, "POST", `/api/conversations/${c}/messages`, {
          content: "x",
          attachmentIds: [up.json.attachment.id],
        })
      ).status,
    ).toBe(404);
    await writeFile(join(root, "me", A, ".env"), "TOKEN=abc");
    await writeFile(join(root, "me", A, "id_rsa"), "KEY");
    await writeFile(join(root, "me", A, "plain.txt"), "fine");
    for (const bad of ["me/.env", "me/id_rsa"])
      expect(
        (
          await call(A, "POST", `/api/conversations/${c}/messages`, {
            content: "x",
            fileRefs: [bad],
          })
        ).status,
      ).toBe(404);
    expect(
      (await call(A, "GET", "/api/files?path=me")).json.entries.map(
        (e: { name: string }) => e.name,
      ),
    ).not.toContain(".env");
    const ok = await call(A, "POST", `/api/conversations/${c}/messages`, {
      content: "read",
      fileRefs: ["me/plain.txt"],
    });
    expect(ok.status).toBe(201);
    const stored = (
      await db.$client.query("select meta from message where id = $1", [ok.json.user.id])
    ).rows[0].meta;
    expect(stored.fileHashes[0]).toMatchObject({ path: "me/plain.txt" });
    expect(stored.fileHashes[0].sha256).toHaveLength(64);
  });
});
