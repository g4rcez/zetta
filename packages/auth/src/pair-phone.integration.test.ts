import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq, sql } from "@zetta/db/query";
import { user, verification } from "@zetta/db/schema/auth";
import { createAuth } from "./index";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const email = `pair-${crypto.randomUUID()}@example.invalid`;

suite("pairing a phone by QR code", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  // describe.skip still runs this body, and createAuth() queries the database in the background when it is created. Without a database
  // that query fails after the suite is skipped and breaks whichever test is running then (ECONNREFUSED), so it is made in beforeAll.
  const makeAuth = () =>
    createAuth(
      {
        BETTER_AUTH_URL: "https://auth.example.test",
        BETTER_AUTH_SECRET: "synthetic-only-not-a-production-secret",
        CORS_ORIGIN: "https://web.example.test",
      },
      db,
    );
  let auth: ReturnType<typeof makeAuth>;
  beforeAll(() => {
    auth = makeAuth();
  });
  const cookieOf = (h: Headers) =>
    new Headers({
      cookie: h
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
  const desktop = async () => {
    await auth.api.signUpEmail({
      body: { name: "Pair Test", email, password: "synthetic-pass-1234" },
    });
    const res = await auth.api.signInEmail({
      body: { email, password: "synthetic-pass-1234" },
      returnHeaders: true,
    });
    return cookieOf(res.headers);
  };
  let desktopHeaders: Headers;
  const start = async () =>
    (await auth.api.startPairPhone({ headers: desktopHeaders })) as { code: string };
  const redeem = (code: string) =>
    auth.api.redeemPairPhone({ body: { code }, returnHeaders: true });

  afterAll(async () => {
    await db.delete(user).where(eq(user.email, email));
    await db.delete(verification).where(sql`${verification.identifier} like ${"pair-phone:%"}`);
  });

  test("a code from a signed-in browser gives the phone a session of its own", async () => {
    desktopHeaders = await desktop();
    const { code } = await start();
    const phone = cookieOf((await redeem(code)).headers);
    const desktopToken = (await auth.api.getSession({ headers: desktopHeaders }))!.session.token;
    const phoneToken = (await auth.api.getSession({ headers: phone }))!.session.token;
    expect(phoneToken).not.toBe(desktopToken);

    // Revoking the phone leaves the desktop signed in.
    await auth.api.revokeSession({ headers: desktopHeaders, body: { token: phoneToken } });
    expect(await auth.api.getSession({ headers: phone })).toBeNull();
    expect(await auth.api.getSession({ headers: desktopHeaders })).not.toBeNull();
  });

  test("a code works once", async () => {
    const { code } = await start();
    await redeem(code);
    await expect(redeem(code)).rejects.toMatchObject({ body: { code: "INVALID_PAIR_CODE" } });
  });

  test("a made-up code is refused", async () => {
    await expect(redeem("x".repeat(43))).rejects.toMatchObject({
      body: { code: "INVALID_PAIR_CODE" },
    });
  });

  test("an expired code is refused", async () => {
    const { code } = await start();
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(sql`${verification.identifier} like ${"pair-phone:%"}`);
    await expect(redeem(code)).rejects.toMatchObject({ body: { code: "INVALID_PAIR_CODE" } });
  });

  test("a browser that is not signed in cannot make a code", async () => {
    await expect(auth.api.startPairPhone({ headers: new Headers() })).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
  });
});
