import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { ComputerError, createComputerService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url && process.env.ZETTA_COMPUTER_TEST === "1" ? describe : describe.skip;
const id = `comp-${uuidv7()}`;
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as ComputerError).code);

suite("browser profiles (real chromium + database)", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  let root: string; let svc: ReturnType<typeof createComputerService>;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zetta-profiles-")); svc = createComputerService({ db, root, allowPrivate: true });
    const now = new Date();
    await db.insert(user).values({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(membership).values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => { await svc.closeAll(); await cleanupTestUsers(db, [id]); });

  test("profiles are registered per owner, can be reset, and a revoked profile cannot be started again", async () => {
    await svc.start(id, "shared"); await svc.start(id, "b-12345678");
    expect((await svc.profiles(id)).map((p) => `${p.name}:${p.mode}`).sort()).toEqual(["b-12345678:dedicated", "shared:shared"]);
    const dir = join(root, "profiles", id.replace(/[^A-Za-z0-9_-]/g, "_"));
    expect((await readdir(dir)).sort()).toEqual(["b-12345678", "shared"]);
    await svc.reset(id, "shared");
    expect((await readdir(dir)).includes("shared")).toBe(false); // state deleted
    await svc.start(id, "shared"); // usable again, starts empty
    await svc.revokeProfile(id, "b-12345678");
    expect(await code(svc.start(id, "b-12345678"))).toBe("REVOKED");
    expect((await svc.profiles(id)).find((p) => p.name === "b-12345678")!.revoked).toBe(true);
    expect(svc.capabilities().desktop).toBe(false);
  }, 60_000);
});
