// The pool sets every connection it hands out to the workspace of the work that asked (packages/db/src/index.ts, tenant.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asWorkspace, createDb, SCAN_ALL, tenant } from "@zetta/db";
import { asc, inArray, sql } from "@zetta/db/query";
import { workspace } from "@zetta/db/schema/workspaces";
import { uuidv7 } from "@zetta/core/uuid";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("the workspace of each connection", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const made: string[] = [];
  let first = "";
  const A = uuidv7();
  const B = uuidv7();

  /** What the connection that runs this query is set to. */
  const seen = async (handle: { execute: typeof db.execute } = db) =>
    (
      await handle.execute<{ value: string | null }>(
        sql`select current_setting('app.workspace_id', true) as value`,
      )
    ).rows[0]!.value;

  beforeAll(async () => {
    for (const [id, slug] of [
      [A, `pool-a-${A.slice(-8)}`],
      [B, `pool-b-${B.slice(-8)}`],
    ] as const) {
      await db.insert(workspace).values({ id, slug, name: slug });
      made.push(id);
    }
    const [oldest] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .orderBy(asc(workspace.createdAt), asc(workspace.id))
      .limit(1);
    first = oldest!.id;
  });

  afterAll(async () => {
    await tenant.none(() => db.delete(workspace).where(inArray(workspace.id, made)));
    await db.$client.end();
  });

  test("work for a workspace runs on connections set to it, also when two run at once on the same pool", async () => {
    const [a, b] = await Promise.all([
      tenant.run(A, async () => {
        await Bun.sleep(5);
        return seen();
      }),
      tenant.run(B, () => seen()),
    ]);
    expect(a).toBe(A);
    expect(b).toBe(B);
    // Many at once, more than the pool has connections: none is handed out with the setting of the work before.
    const many = await Promise.all(
      Array.from({ length: 60 }, (_, i) => {
        const id = i % 2 ? A : B;
        return tenant.run(id, async () => ((await seen()) === id ? "right" : "wrong"));
      }),
    );
    expect(many.every((r) => r === "right")).toBe(true);
  });

  test("a query handed back unstarted (a lazy query builder) still runs for the workspace it was made in", async () => {
    const read = () =>
      db.execute<{ value: string | null }>(
        sql`select current_setting('app.workspace_id', true) as value`,
      );
    expect((await tenant.run(A, read)).rows[0]!.value).toBe(A);
    expect(
      (await tenant.run(B, () => db.select({ id: workspace.id }).from(workspace).limit(1))).length,
    ).toBe(1);
    expect((await tenant.scan(read)).rows[0]!.value).toBe(SCAN_ALL);
    expect((await tenant.none(read)).rows[0]!.value).toBe(first);
  });

  test("a transaction runs for the workspace it started in, and can write for another one until it ends", async () => {
    await tenant.run(A, () =>
      db.transaction(async (tx) => {
        expect(await seen(tx)).toBe(A);
        await asWorkspace(tx, B);
        expect(await seen(tx)).toBe(B);
      }),
    );
    // The connection goes back to the pool set as it was before the transaction.
    expect(await tenant.run(A, () => seen())).toBe(A);
  });

  test("a request gets its workspace once the person is known, and what it leaves running keeps it", async () => {
    let later: Promise<string | null> | undefined;
    const before = await tenant.open(async () => {
      const unknown = await seen();
      tenant.claim(B);
      later = Bun.sleep(10).then(() => seen());
      return unknown;
    });
    // Before the person is known the request reaches only shared tables, so it may run where work with no workspace runs.
    expect(before).toBe(first);
    expect(await later!).toBe(B);
  });

  test("a request that names its person by a token takes their workspace, and one that has a workspace keeps it", async () => {
    const taken = await tenant.open(async () => {
      tenant.claimIfOpen(A);
      return seen();
    });
    expect(taken).toBe(A);
    const kept = await tenant.open(async () => {
      tenant.claim(A);
      // Acting for someone else, in another workspace, does not move the request.
      tenant.claimIfOpen(B);
      return seen();
    });
    expect(kept).toBe(A);
  });

  test("routing reads across workspaces, and work with no workspace runs in the first one on a server of one's own", async () => {
    expect(await tenant.scan(() => seen())).toBe(SCAN_ALL);
    expect(await tenant.none(() => seen())).toBe(first);
    // A claim outside a request does nothing.
    tenant.claim(A);
    expect(await seen()).toBe(first);
  });

  test("in app mode, work with no workspace runs nowhere", async () => {
    const before = process.env.ZETTA_MODE;
    process.env.ZETTA_MODE = "app";
    const app = createDb({ DATABASE_URL: url! } as never);
    if (before === undefined) delete process.env.ZETTA_MODE;
    else process.env.ZETTA_MODE = before;
    try {
      expect(await seen(app)).toBe("");
      expect(await tenant.run(A, () => seen(app))).toBe(A);
    } finally {
      await app.$client.end();
    }
  });

  test("only a workspace id is accepted", () => {
    expect(() => tenant.run("x' or true --", () => 1)).toThrow("not a workspace id");
    expect(() => tenant.open(() => tenant.claim(SCAN_ALL))).toThrow("not a workspace id");
  });
});
