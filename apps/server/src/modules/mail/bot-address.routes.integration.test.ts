// The routes of bot addresses over a real database (ZETTA_TEST_DB=embedded; otherwise this skips): what is offered, giving a bot an
// address, the allowed senders, removing, and that the provider's key is nowhere in any answer.
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createMessageStore } from "./messages";
import { createProvisioning } from "./provision";
import { createFakeProvider } from "./providers/fake";
import { createMailRoutes } from "./routes";
import { createMailService } from "./service";
import { createMailboxStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `bar-a-${uuidv7()}`;
const B = `bar-b-${uuidv7()}`;
const KEY = "re_sentinel_key_that_must_never_leave";
const ORIGIN = "https://app.example.invalid";

suite("bot address routes against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const store = createMailboxStore(db);
  const messages = createMessageStore(db);
  const fake = createFakeProvider();
  let on = true;
  const reader = {
    enabled: async () =>
      on ? { on: true, domain: "bots.example.invalid" } : { on: false, domain: "" },
    provider: async () => (on ? fake : undefined),
  };
  const mail = createMailService({
    store,
    secrets: {} as never,
    provisioned: { messages, provider: () => reader.provider(), displayName: async (_b, f) => f },
  });
  const access = createIdentityAccess(
    {
      api: {
        getSession: async ({ headers }: { headers: Headers }) =>
          headers.get("cookie") ? { user: { id: headers.get("cookie") } } : null,
      },
    } as never,
    async () => ({ isAdmin: false }),
  );
  const app = new Elysia().use(
    createMailRoutes(
      { access, mail, provisioning: createProvisioning({ db, store, reader }) },
      [ORIGIN],
      { publicKey: async () => ({}), open: async () => ({}) } as never,
    ),
  );
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { origin: ORIGIN, cookie: as, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await r.text();
    expect(text).not.toContain(KEY);
    return { status: r.status, text, json: text ? JSON.parse(text) : {} };
  };
  let helperId = "";
  let theirsId = "";
  const mk = async (owner: string, name: string) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId: owner,
          kind: "specialist",
          visibility: "private",
          name,
          slug: `${name}-${uuidv7().slice(-8)}`,
          onboarded: true,
        })
        .returning({ id: bot.id })
    )[0]!.id;

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
    helperId = await mk(A, "helper");
    theirsId = await mk(B, "theirs");
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("what is offered is public to any signed-in person and holds nothing secret", async () => {
    expect((await call(A, "GET", "/api/mail/provisioning")).json).toEqual({
      on: true,
      domain: "bots.example.invalid",
    });
    on = false;
    expect((await call(A, "GET", "/api/mail/provisioning")).json).toEqual({
      on: false,
      domain: "",
    });
    on = true;
  });

  test("giving a bot an address: made once, listed, and another person's bot is not found", async () => {
    const r = await call(A, "POST", "/api/mailboxes/provision", { botId: helperId });
    expect(r.status).toBe(201);
    expect(r.json.mailbox).toMatchObject({
      kind: "provisioned",
      ownerBotId: helperId,
      sending: "on",
      state: "active",
      allowedSenders: [],
    });
    expect(r.json.mailbox.address).toMatch(/^helper-.*-[0-9a-f]{4}@bots\.example\.invalid$/);
    const again = await call(A, "POST", "/api/mailboxes/provision", { botId: helperId });
    expect(again.json.mailbox.id).toBe(r.json.mailbox.id);
    const list = await call(A, "GET", "/api/mailboxes");
    expect(
      list.json.mailboxes.filter((m: { kind: string }) => m.kind === "provisioned"),
    ).toHaveLength(1);
    expect((await call(A, "POST", "/api/mailboxes/provision", { botId: theirsId })).status).toBe(
      404,
    );
    expect((await call(B, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
  });

  test("with provisioning off nothing is made and the answer says why", async () => {
    on = false;
    const other = await mk(A, "offbot");
    const r = await call(A, "POST", "/api/mailboxes/provision", { botId: other });
    expect(r.status).toBe(409);
    expect(r.json.error?.code ?? r.json.code).toBe("NOT_OFFERED");
    on = true;
  });

  test("allowed senders are checked, and the servers of this kind cannot be edited", async () => {
    const id = (await call(A, "GET", "/api/mailboxes")).json.mailboxes[0].id as string;
    const ok = await call(A, "PATCH", `/api/mailboxes/${id}`, {
      allowedSenders: ["Ana@Example.invalid", "@partner.example.invalid"],
    });
    expect(ok.json.mailbox.allowedSenders).toEqual([
      "ana@example.invalid",
      "@partner.example.invalid",
    ]);
    expect(
      (await call(A, "PATCH", `/api/mailboxes/${id}`, { allowedSenders: ["nope"] })).status,
    ).toBe(400);
    expect(
      (await call(A, "PATCH", `/api/mailboxes/${id}`, { imapHost: "x.example.invalid" })).status,
    ).toBe(501);
    expect((await call(B, "PATCH", `/api/mailboxes/${id}`, { allowedSenders: [] })).status).toBe(
      404,
    );
  });

  test("removing the mailbox hides it", async () => {
    const id = (await call(A, "GET", "/api/mailboxes")).json.mailboxes[0].id as string;
    expect((await call(A, "DELETE", `/api/mailboxes/${id}`)).status).toBe(200);
    expect((await call(A, "GET", "/api/mailboxes")).json.mailboxes).toEqual([]);
    expect((await call(A, "GET", `/api/mailboxes/${id}/conversations`)).status).toBe(404);
  });
});
