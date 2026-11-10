import { createAuthOptions } from "@zetta/auth";
import { createDb } from "@zetta/db";
import { inArray, sql } from "@zetta/db/query";
import { account, session, user } from "@zetta/db/schema/auth";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const run = Math.random().toString(36).slice(-8);
const config = {
  BETTER_AUTH_URL: "https://auth.example.invalid",
  CORS_ORIGIN: "https://web.example.invalid",
  BETTER_AUTH_SECRET: "x".repeat(48),
};
// The invitation gate needs a 43-character base64url token. The verifier approves any such token: only the duplicate-email rule is under test.
const token = Buffer.alloc(32, 7).toString("base64url");

suite("sign-up with an email that already has an account", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  // describe.skip still runs this body, and betterAuth() queries the database in the background when it is created.
  // Without a database that query fails after the suite is skipped and breaks whichever test is running then.
  const makeAuth = () =>
    betterAuth({
      ...createAuthOptions(config, db, [], { invitationSignupVerifier: async () => true }),
      logger: { disabled: true },
      telemetry: { enabled: false, debug: false },
    });
  let auth: ReturnType<typeof makeAuth>;
  beforeAll(() => {
    auth = makeAuth();
  });
  const signUp = (email: string) =>
    auth.handler(
      new Request(`${config.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin: config.CORS_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Dup Test",
          email,
          password: "a-long-test-password",
          invitationToken: token,
        }),
      }),
    );
  const rows = async (email: string) =>
    (
      await db
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${email.toLowerCase()}`)
    ).map((r) => r.id);

  afterAll(async () => {
    const ids = (
      await db
        .select({ id: user.id })
        .from(user)
        .where(sql`${user.email} like ${`%-${run}@example.invalid`}`)
    ).map((r) => r.id);
    if (ids.length === 0) return;
    await db.delete(session).where(inArray(session.userId, ids));
    await db.delete(account).where(inArray(account.userId, ids));
    await db.delete(user).where(inArray(user.id, ids));
  });

  test("the same email is refused and no second user exists", async () => {
    const email = `same-${run}@example.invalid`;
    expect((await signUp(email)).status).toBe(200);
    expect((await signUp(email)).status).toBe(422);
    expect(await rows(email)).toHaveLength(1);
  });

  test("the same email in other letter case is refused and no second user exists", async () => {
    const email = `case-${run}@example.invalid`;
    expect((await signUp(email)).status).toBe(200);
    expect((await signUp(email.toUpperCase())).status).toBe(422);
    expect((await signUp(`Case-${run}@Example.invalid`)).status).toBe(422);
    expect(await rows(email)).toHaveLength(1);
  });

  test("two sign-ups at the same time create one user", async () => {
    const email = `race-${run}@example.invalid`;
    const statuses = (await Promise.all([signUp(email), signUp(email), signUp(email)]))
      .map((r) => r.status)
      .sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(await rows(email)).toHaveLength(1);
  });

  test("the database refuses an email that is not in lower case", async () => {
    const now = new Date();
    const insert = async () => {
      await db.insert(user).values({
        id: `raw-${run}`,
        name: "Raw",
        email: `Raw-${run}@example.invalid`,
        createdAt: now,
        updatedAt: now,
      });
    };
    await expect(insert()).rejects.toThrow();
    expect(await rows(`raw-${run}@example.invalid`)).toHaveLength(0);
  });
});
