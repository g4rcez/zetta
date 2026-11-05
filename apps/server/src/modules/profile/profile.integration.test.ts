import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { session, user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { eq } from "@zetta/db/query";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, createMembershipLookup } from "../identity/access";
import { createPreferenceStore } from "../preferences/store";
import { createProfileStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `prof-a-${uuidv7()}`;
const B = `prof-b-${uuidv7()}`;
const UNENROLLED = `prof-u-${uuidv7()}`;
const S_THIS = `sess-this-${uuidv7()}`;
const S_OTHER = `sess-other-${uuidv7()}`;
const S_EXPIRED = `sess-old-${uuidv7()}`;
const S_B = `sess-b-${uuidv7()}`;
const PRESET = { kind: "preset", preset: "blob", colors: ["#336699", "#ffcc00"] };
const IMAGE = { kind: "image", src: "data:image/webp;base64,UklGRg==" };

suite("profile against compose postgres", () => {
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
    createMembershipLookup(db),
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    profile: {
      access,
      profile: createProfileStore(db),
      currentSessionId: async (headers) => headers.get("x-test-session") ?? undefined,
    },
    preferences: { access, preferences: createPreferenceStore(db) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = (
    as: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const profile = async (as: string) =>
    ((await (await call(as, "GET", "/api/profile")).json()) as { profile: Record<string, unknown> })
      .profile;

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [
        [A, "Ada Test"],
        [B, "Bob Test"],
        [UNENROLLED, "Una Test"],
      ].map(([id, name]) => ({
        id: id!,
        name: name!,
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
    const hour = 3_600_000;
    const row = (id: string, userId: string, ageHours: number, expiresInHours: number) => ({
      id,
      userId,
      token: `token-${id}`,
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/130.0",
      createdAt: new Date(now.getTime() - ageHours * hour),
      updatedAt: now,
      expiresAt: new Date(now.getTime() + expiresInHours * hour),
    });
    await db
      .insert(session)
      .values([
        row(S_OTHER, A, 5, 100),
        row(S_THIS, A, 1, 100),
        row(S_EXPIRED, A, 50, -1),
        row(S_B, B, 2, 100),
      ]);
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B, UNENROLLED]);
  });

  test("a person with no changes has their name, email and no avatar", async () => {
    expect(await profile(A)).toEqual({
      name: "Ada Test",
      email: `${A}@example.invalid`,
      avatar: null,
    });
  });

  test("a new name is trimmed, saved, and changes only that person", async () => {
    const res = await call(A, "PATCH", "/api/profile", { name: "  Ada Lovelace  " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { profile: { name: string } }).profile.name).toBe("Ada Lovelace");
    expect((await profile(A)).name).toBe("Ada Lovelace");
    expect((await profile(B)).name).toBe("Bob Test");
  });

  test.each([
    ["an empty name", { name: "   " }],
    ["a name of 81 characters", { name: "a".repeat(81) }],
    ["a name with a control character", { name: "Ada\u0007" }],
    ["an email", { email: "other@example.invalid" }],
    ["an unknown key", { name: "Ada", role: "admin" }],
  ])("%s is refused", async (_what, body) => {
    const res = await call(A, "PATCH", "/api/profile", body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    expect((await profile(A)).email).toBe(`${A}@example.invalid`);
  });

  test("a preset and an uploaded image are kept, and null clears the picture", async () => {
    for (const avatar of [PRESET, IMAGE]) {
      const res = await call(A, "PATCH", "/api/profile", { avatar });
      expect(res.status).toBe(200);
      expect((await profile(A)).avatar).toEqual(avatar);
    }
    expect((await profile(B)).avatar).toBeNull();
    await call(A, "PATCH", "/api/profile", { avatar: null });
    expect((await profile(A)).avatar).toBeNull();
  });

  test.each([
    ["an SVG", { kind: "image", src: "data:image/svg+xml;base64,AA==" }],
    [
      "an image over the limit",
      { kind: "image", src: `data:image/png;base64,${"A".repeat(300_000)}` },
    ],
    ["five colors", { ...PRESET, colors: Array(5).fill("#336699") }],
    ["a plain URL", "https://example.invalid/a.png"],
  ])("%s is refused as a picture", async (_what, avatar) => {
    const res = await call(A, "PATCH", "/api/profile", { avatar });
    expect(res.status).toBe(400);
  });

  test("the picture is not part of the layout preferences", async () => {
    await call(A, "PATCH", "/api/profile", { avatar: PRESET });
    const res = await call(A, "GET", "/api/preferences");
    expect(Object.keys(((await res.json()) as { preferences: object }).preferences).sort()).toEqual(
      ["botOrder", "listWidth", "railMode", "railWidth", "timeFormat"],
    );
    await call(A, "PATCH", "/api/profile", { avatar: null });
  });

  test("a write from an untrusted origin is refused", async () => {
    const res = await call(
      A,
      "PATCH",
      "/api/profile",
      { name: "Mallory" },
      { origin: "http://evil.test" },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNTRUSTED_ORIGIN");
    expect((await profile(A)).name).toBe("Ada Lovelace");
  });

  test("someone who has not joined yet has no profile to read or change", async () => {
    expect((await call(UNENROLLED, "GET", "/api/profile")).status).toBe(403);
    expect((await call(UNENROLLED, "PATCH", "/api/profile", { name: "Una" })).status).toBe(403);
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, UNENROLLED));
    expect(row?.name).toBe("Una Test");
  });

  test("the session list holds only this person's live sessions, this browser first, with no token", async () => {
    const res = await call(A, "GET", "/api/profile/sessions", undefined, {
      "x-test-session": S_THIS,
    });
    const { sessions } = (await res.json()) as { sessions: Record<string, unknown>[] };
    expect(sessions.map((s) => [s.id, s.device])).toEqual([
      [S_THIS, "this"],
      [S_OTHER, "other"],
    ]);
    expect(Object.keys(sessions[0]!).sort()).toEqual([
      "createdAt",
      "device",
      "id",
      "ipAddress",
      "userAgent",
    ]);
  });

  test("without a known current session every row is another device", async () => {
    const res = await call(B, "GET", "/api/profile/sessions");
    const { sessions } = (await res.json()) as { sessions: { id: string; device: string }[] };
    expect(sessions).toEqual([expect.objectContaining({ id: S_B, device: "other" })]);
  });
});
