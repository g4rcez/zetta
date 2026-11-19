import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { mcpServer } from "@zetta/db/schema/features";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { issueBackgroundActor, createMembershipLookup } from "../identity/access";
import { createMcp } from "../integrations/mcp";
import { createConnectionStore } from "../connections/store";
import { createConnectionsService } from "../connections/service";
import { createDesktopLinkRoutes } from "./routes";
import { createDesktopLink } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const OWNER = `dl-owner-${uuidv7()}`;
const TOKEN = "t".repeat(48);
const KEY = Buffer.alloc(32, 7).toString("base64");
const REMOTE = "https://cloud.example.invalid";

suite("desktop link against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  let link!: ReturnType<typeof createDesktopLink>;
  let connections!: ReturnType<typeof createConnectionsService>;
  const lookupAdmin = async () => (ownerReady ? issueBackgroundActor(lookup, OWNER) : null);
  let ownerReady = true;
  let from = "127.0.0.1";
  let app!: { handle(request: Request): Promise<Response> };
  const call = (
    method: string,
    body: unknown,
    headers: Record<string, string> = { "x-zetta-desktop-link": TOKEN },
  ) =>
    app.handle(
      new Request("http://127.0.0.1/api/desktop/remotes", {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  const stateOf = async (id: string) =>
    (await connections.list((await lookupAdmin())!)).find((c) => c.id === id)?.state;
  const servers = () => db.select().from(mcpServer).where(eq(mcpServer.ownerUserId, OWNER));

  beforeAll(async () => {
    const store = await createConnectionStore(db, {
      configuration: { key: KEY, keyId: "v1" },
      allowedProviders: ["plugin"],
      initializeEmpty: true,
    });
    connections = createConnectionsService(db, store);
    link = createDesktopLink({
      db,
      connections,
      mcp: createMcp(db, connections, { allowPrivate: true }),
      admin: lookupAdmin,
    });
    app = new Elysia().use(createDesktopLinkRoutes(link, TOKEN, () => from) as never);
    const now = new Date();
    await db
      .insert(user)
      .values({
        id: OWNER,
        name: "Owner Test",
        email: `${OWNER}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    await db
      .insert(membership)
      .values({ userId: OWNER, status: "active", joinedAt: now, updatedAt: now });
    await db
      .insert(installationIdentity)
      .values({ id: 1, adminUserId: OWNER, bootstrappedAt: now })
      .onConflictDoUpdate({ target: installationIdentity.id, set: { adminUserId: OWNER } });
  });
  afterAll(async () => {
    for (const t of [
      "bot_integration",
      "mcp_server",
      "connection_credential",
      "connection_mutation_receipt",
    ])
      await db.$client.query(`delete from ${t} where owner_user_id = $1`, [OWNER]);
    await db.$client.query("delete from connection where owner_user_id = $1", [OWNER]);
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await cleanupTestUsers(db, [OWNER]);
  });

  test("without the token, or from another computer, the routes do not exist", async () => {
    expect((await call("PUT", { origin: REMOTE, accessToken: "x" }, {})).status).toBe(404);
    expect(
      (await call("PUT", { origin: REMOTE, accessToken: "x" }, { "x-zetta-desktop-link": "wrong" }))
        .status,
    ).toBe(404);
    from = "192.168.1.20";
    expect((await call("PUT", { origin: REMOTE, accessToken: "x" })).status).toBe(404);
    from = "127.0.0.1";
    expect(await servers()).toHaveLength(0);
  });

  test("links the remote as an MCP server whose token is sealed, and a second call swaps the token", async () => {
    const first = await call("PUT", { origin: REMOTE, accessToken: "access-one" });
    expect(first.status).toBe(200);
    const [row] = await servers();
    expect(row).toMatchObject({
      name: "Zetta: cloud.example.invalid",
      transport: "http",
      url: `${REMOTE}/api/mcp`,
      sharing: "private",
    });
    const firstConnection = row!.connectionId!;
    const secretOf = async (id: string) =>
      (await connections.secretFor((await lookupAdmin()) as never, id)).toString("utf8");
    expect(await secretOf(firstConnection)).toBe("access-one");

    expect((await call("PUT", { origin: REMOTE, accessToken: "access-two" })).status).toBe(200);
    const after = await servers();
    expect(after).toHaveLength(1);
    expect(await secretOf(after[0]!.connectionId!)).toBe("access-two");
    expect(await stateOf(firstConnection)).not.toBe("active");
  });

  test("a remote that is not a plain origin is refused", async () => {
    for (const origin of [
      "javascript:alert(1)",
      "https://cloud.example.invalid/path",
      "https://u:p@cloud.example.invalid",
      "nope",
    ])
      expect((await call("PUT", { origin, accessToken: "x" })).status).toBe(400);
  });

  test("before anyone has signed up there is no owner to link to", async () => {
    ownerReady = false;
    expect(
      (await call("PUT", { origin: "https://other.example.invalid", accessToken: "x" })).status,
    ).toBe(409);
    ownerReady = true;
  });

  test("disconnecting removes the server and revokes its token", async () => {
    const [row] = await servers();
    const connectionId = row!.connectionId!;
    const res = await call("DELETE", { origin: REMOTE });
    expect(await res.json()).toEqual({ removed: true });
    expect(await servers()).toHaveLength(0);
    expect(await stateOf(connectionId)).not.toBe("active");
    expect(await (await call("DELETE", { origin: REMOTE })).json()).toEqual({ removed: false });
  });
});
