import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createPeopleDirectory } from "../people/directory";
import { createProfileStore } from "../profile/store";
import { createAvatarStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `avatar-a-${uuidv7()}`;
const B = `avatar-b-${uuidv7()}`;
// A 1x1 PNG, and a different one (the same pixel in another color) to tell pictures apart.
const PNG_1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const dataUrl = (b64: string) => ({ kind: "image", src: `data:image/png;base64,${b64}` });
const LINK = /^\/api\/avatars\/(bot|user)\/[A-Za-z0-9_-]+\?v=[a-z0-9]+$/;

suite("avatars as links against compose postgres", () => {
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
  const fakeRun = Object.assign(async () => ({ text: "ok", stopped: false }), {
    stream: async function* () {
      yield "ok";
    },
  });
  const avatars = createAvatarStore(db);
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: createChatService(db, fakeRun as never), avatars },
    avatars: { access, avatars },
    profile: {
      access,
      profile: createProfileStore(db),
      people: createPeopleDirectory(db),
      currentSessionId: async () => undefined,
      avatars,
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = (as: string | null, method: string, path: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  type BotJson = { id: string; version: number; avatar: { kind: string; src?: string } | null };
  const newBot = async (as: string, avatar?: unknown, extra: object = {}) => {
    const res = await call(as, "POST", "/api/bots", {
      name: `Avatar ${uuidv7().slice(-6)}`,
      avatar,
      ...extra,
    });
    return { res, bot: ((await res.json()) as { bot: BotJson }).bot };
  };
  const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString("base64");

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [A, B].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
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
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("a preset is a public, cacheable svg for one look", async () => {
    const res = await call(null, "GET", "/api/avatars/preset/robot.svg?c=0f172a-94a3b8-22d3ee&v=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("#0f172a");
    expect(svg).not.toMatch(/<script/i);
  });

  test("a preset url with bad input is refused", async () => {
    expect((await call(null, "GET", "/api/avatars/preset/robot.svg?c=zzz")).status).toBe(400);
    expect((await call(null, "GET", "/api/avatars/preset/robot.png?c=0f172a")).status).toBe(400);
    expect((await call(null, "GET", "/api/avatars/preset/ghost-town.svg?c=0f172a")).status).toBe(
      404,
    );
  });

  test("a preset avatar stays a preset in the list", async () => {
    const preset = { kind: "preset", preset: "star", colors: ["#4a80e6"] };
    const { bot } = await newBot(A, preset);
    expect(bot.avatar).toEqual(preset);
  });

  test("an uploaded picture leaves as a link, never as base64, and the link serves it", async () => {
    const { res, bot } = await newBot(A, dataUrl(PNG_1));
    expect(res.status).toBe(201);
    expect(bot.avatar?.src).toMatch(LINK);
    expect(bot.avatar?.src).toContain(`/bot/${bot.id}`);

    const list = await (await call(A, "GET", "/api/bots")).text();
    expect(list).not.toContain("data:image");
    expect(list).toContain(bot.avatar!.src!);

    const img = await call(A, "GET", bot.avatar!.src!);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await bytes(img)).toBe(PNG_1);
  });

  test("a picture needs a signed-in member", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_1));
    expect((await call(null, "GET", bot.avatar!.src!)).status).toBe(401);
    await call(A, "PATCH", "/api/profile", { avatar: dataUrl(PNG_1) });
    expect((await call(null, "GET", `/api/avatars/user/${A}`)).status).toBe(401);
  });

  test("a bot's picture is public to the organization, whoever owns it and however it is shared", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_1), { visibility: "private" });
    const img = await call(B, "GET", bot.avatar!.src!);
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await bytes(img)).toBe(PNG_1);
  });

  test("a new picture is a new link, so the old one can stay cached", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_1));
    const res = await call(A, "PATCH", `/api/bots/${bot.id}`, {
      expectedVersion: bot.version,
      patch: { avatar: dataUrl(PNG_2) },
    });
    const next = ((await res.json()) as { bot: BotJson }).bot;
    expect(next.avatar?.src).toMatch(LINK);
    expect(next.avatar?.src).not.toBe(bot.avatar?.src);
    expect(await bytes(await call(A, "GET", next.avatar!.src!))).toBe(PNG_2);
  });

  test("saving the link the client was given keeps the stored picture", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_1));
    const res = await call(A, "PATCH", `/api/bots/${bot.id}`, {
      expectedVersion: bot.version,
      patch: { avatar: bot.avatar },
    });
    expect(res.status).toBe(200);
    const next = ((await res.json()) as { bot: BotJson }).bot;
    expect(next.avatar?.src).toBe(bot.avatar!.src!);
    expect(await bytes(await call(A, "GET", next.avatar!.src!))).toBe(PNG_1);
  });

  test("a duplicate made from a link gets a copy of the picture under its own link", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_2));
    const { res, bot: copy } = await newBot(A, bot.avatar);
    expect(res.status).toBe(201);
    expect(copy.avatar?.src).toContain(`/bot/${copy.id}`);
    expect(await bytes(await call(A, "GET", copy.avatar!.src!))).toBe(PNG_2);
  });

  test("another member may copy a bot's picture from its link, even from a private bot", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_1), { visibility: "private" });
    const { res, bot: copy } = await newBot(B, bot.avatar);
    expect(res.status).toBe(201);
    expect(copy.avatar?.src).toContain(`/bot/${copy.id}`);
    expect(await bytes(await call(B, "GET", copy.avatar!.src!))).toBe(PNG_1);
  });

  test("an archived bot has no picture to serve", async () => {
    const { bot } = await newBot(A, dataUrl(PNG_1));
    expect((await call(A, "DELETE", `/api/bots/${bot.id}`)).status).toBe(200);
    expect((await call(A, "GET", bot.avatar!.src!)).status).toBe(404);
  });

  test("a link that points at nothing, or at another origin, is refused", async () => {
    const ghost = { kind: "image", src: `/api/avatars/bot/${uuidv7()}?v=abc` };
    expect((await call(A, "POST", "/api/bots", { name: "Ghost", avatar: ghost })).status).toBe(400);
    const foreign = { kind: "image", src: "https://example.invalid/a.png" };
    expect((await call(A, "POST", "/api/bots", { name: "Foreign", avatar: foreign })).status).toBe(
      400,
    );
  });

  test("a person's picture is a link too, readable by other members", async () => {
    const set = await call(A, "PATCH", "/api/profile", { avatar: dataUrl(PNG_1) });
    expect(set.status).toBe(200);
    const profile = ((await set.json()) as { profile: { avatar: { src: string } } }).profile;
    expect(profile.avatar.src).toMatch(LINK);
    expect(profile.avatar.src).toContain(`/user/${A}`);
    expect(await bytes(await call(B, "GET", profile.avatar.src))).toBe(PNG_1);

    const people = (await (await call(B, "GET", "/api/people")).json()) as {
      people: { userId: string; avatar: { src?: string } | null }[];
    };
    expect(people.people.find((p) => p.userId === A)?.avatar?.src).toBe(profile.avatar.src);

    // The person saves the link they were given: the picture stays.
    const again = await call(A, "PATCH", "/api/profile", { avatar: profile.avatar });
    expect(again.status).toBe(200);
    expect(await bytes(await call(B, "GET", profile.avatar.src))).toBe(PNG_1);
  });

  test("a member with no picture, or one that left, has none to serve", async () => {
    expect((await call(B, "GET", `/api/avatars/user/${B}`)).status).toBe(404);
    expect((await call(A, "GET", `/api/avatars/user/${uuidv7()}`)).status).toBe(404);
    expect((await call(A, "GET", "/api/avatars/bot/not-a-uuid")).status).toBe(404);
  });
});
