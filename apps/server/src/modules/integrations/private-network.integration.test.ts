// An MCP server on a private address: refused while the setting `allowPrivateNetwork` is off, accepted when it is turned on, refused again
// when it is turned off, in one process with no restart. The old variable has no effect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { uuidv7 } from "@zetta/core/uuid";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createPrivateNetworkPolicy } from "../settings/private-network";
import { createTestSettings } from "../settings/testing";
import { createMcp } from "./mcp";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `pn-a-${uuidv7()}`;
const admin = { userId: A, isAdmin: true };

suite("MCP servers and the private-network setting", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: A,
      email: `${A}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active" as const, joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await db.$client.query("delete from mcp_server where owner_user_id = $1", [A]);
    await cleanupTestUsers(db, [A]);
  });

  test("a server address on this machine is refused, allowed, refused again; the old variable changes nothing", async () => {
    const saved = process.env.ZETTA_ALLOW_PRIVATE_NETWORK;
    const t = createTestSettings();
    const mcp = createMcp(db, undefined, {
      allowPrivate: createPrivateNetworkPolicy(t.service).allowed,
      settings: t.service,
    });
    const add = (name: string) =>
      mcp.addServer(admin, { name, transport: "http", url: "http://127.0.0.1:9/mcp" }).then(
        () => "added",
        (e) => (e as { code?: string }).code ?? String(e),
      );
    try {
      process.env.ZETTA_ALLOW_PRIVATE_NETWORK = "1";
      expect(await add("one")).toBe("BLOCKED_URL");
      delete process.env.ZETTA_ALLOW_PRIVATE_NETWORK;
      await t.set("allowPrivateNetwork", "on");
      expect(await add("two")).toBe("added");
      await t.set("allowPrivateNetwork", "off");
      expect(await add("three")).toBe("BLOCKED_URL");
    } finally {
      if (saved === undefined) delete process.env.ZETTA_ALLOW_PRIVATE_NETWORK;
      else process.env.ZETTA_ALLOW_PRIVATE_NETWORK = saved;
    }
  });

  test("a policy that cannot read the setting refuses", async () => {
    const mcp = createMcp(db, undefined, {
      allowPrivate: async () => {
        throw new Error("settings unreadable");
      },
    });
    await expect(
      mcp.addServer(admin, { name: "four", transport: "http", url: "http://127.0.0.1:9/mcp" }),
    ).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });
});
