import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createArtifactStore, type Artifact } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`art-a-${uuidv7()}`, `art-b-${uuidv7()}`];

suite("artifacts against compose postgres", () => {
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
  let artifacts: ReturnType<typeof createArtifactStore>;
  let app: ReturnType<typeof createApp>;
  const call = (as: string, method: string, path: string, headers: Record<string, string> = {}) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "x-test-user": as, origin: "http://web.test", ...headers },
      }),
    );
  const actor = (userId: string) => ({ userId }) as never;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "artifacts-it-"));
    artifacts = createArtifactStore(db, root);
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      artifacts: { access, artifacts },
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
    await rm(root, { recursive: true, force: true });
  });

  const publish = (as: string, content: string, fileName: string, title = "Report") =>
    artifacts.publish(actor(as), { title, fileName, source: { content } });

  test("a published file is listed without content, for its owner only", async () => {
    const row = await publish(ids[0]!, "<h1>Q4</h1>", "q4.html", "Q4 report");
    expect(row).toMatchObject({
      title: "Q4 report",
      kind: "html",
      mimeType: "text/html",
      size: 11,
    });
    const mine = (await (await call(ids[0]!, "GET", "/api/artifacts")).json()) as {
      artifacts: Artifact[];
    };
    expect(mine.artifacts.map((a) => a.title)).toEqual(["Q4 report"]);
    expect(JSON.stringify(mine)).not.toContain("<h1>");
    const theirs = (await (await call(ids[1]!, "GET", "/api/artifacts")).json()) as {
      artifacts: Artifact[];
    };
    expect(theirs.artifacts).toEqual([]);
  });
  test("html is served sandboxed with scripts allowed, other kinds run nothing", async () => {
    const html = await publish(ids[0]!, "<script>1</script>", "a.html", "Page");
    const res = await call(ids[0]!, "GET", `/api/artifacts/${html.id}/content`);
    expect(res.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-forms",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csv = await publish(ids[0]!, "a,b\n1,2", "t.csv", "Table");
    const res2 = await call(ids[0]!, "GET", `/api/artifacts/${csv.id}/content`);
    expect(res2.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res2.headers.get("content-disposition")).toStartWith("attachment");
  });
  test("byte ranges answer 206 so media can seek", async () => {
    const row = await publish(ids[0]!, "0123456789", "n.txt", "Digits");
    const res = await call(ids[0]!, "GET", `/api/artifacts/${row.id}/content`, {
      range: "bytes=2-5",
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
    const bad = await call(ids[0]!, "GET", `/api/artifacts/${row.id}/content`, {
      range: "bytes=50-60",
    });
    expect(bad.status).toBe(416);
  });
  test("another user gets 404 for metadata, content and delete", async () => {
    const row = await publish(ids[0]!, "private", "p.txt", "Private");
    for (const [method, path] of [
      ["GET", `/api/artifacts/${row.id}`],
      ["GET", `/api/artifacts/${row.id}/content`],
      ["DELETE", `/api/artifacts/${row.id}`],
    ] as const)
      expect((await call(ids[1]!, method, path)).status).toBe(404);
  });
  test("delete removes the row and keeps shared bytes while another row uses them", async () => {
    const a = await publish(ids[0]!, "same bytes", "a.txt", "A");
    const b = await publish(ids[0]!, "same bytes", "b.txt", "B");
    expect((await call(ids[0]!, "DELETE", `/api/artifacts/${a.id}`)).status).toBe(200);
    expect((await call(ids[0]!, "GET", `/api/artifacts/${a.id}`)).status).toBe(404);
    expect(await (await call(ids[0]!, "GET", `/api/artifacts/${b.id}/content`)).text()).toBe(
      "same bytes",
    );
  });
  test("a pinned artifact lists first and unpinning puts it back", async () => {
    const older = await publish(ids[1]!, "one", "1.txt", "Older");
    await publish(ids[1]!, "two", "2.txt", "Newer");
    const titles = async (qs = "") =>
      (
        (await (await call(ids[1]!, "GET", `/api/artifacts${qs}`)).json()) as {
          artifacts: Artifact[];
        }
      ).artifacts.map((x) => x.title);
    expect((await titles()).slice(0, 2)).toEqual(["Newer", "Older"]);
    const patch = (pinned: boolean) =>
      app.handle(
        new Request(`http://localhost/api/artifacts/${older.id}`, {
          method: "PATCH",
          headers: {
            "x-test-user": ids[1]!,
            origin: "http://web.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ pinned }),
        }),
      );
    expect((await patch(true)).status).toBe(200);
    expect((await titles()).slice(0, 2)).toEqual(["Older", "Newer"]);
    await patch(false);
    expect((await titles()).slice(0, 2)).toEqual(["Newer", "Older"]);
  });
  test("the largest sort puts the biggest file first", async () => {
    await publish(ids[1]!, "x".repeat(5000), "big.txt", "Big one");
    const res = (await (await call(ids[1]!, "GET", "/api/artifacts?sort=largest")).json()) as {
      artifacts: Artifact[];
    };
    expect(res.artifacts[0]!.title).toBe("Big one");
  });
  test("a publish over the quota is refused and keeps nothing; usage counts shared bytes once", async () => {
    const before = (
      (await (await call(ids[0]!, "GET", "/api/artifacts/usage")).json()) as { used: number }
    ).used;
    process.env.ZETTA_ARTIFACTS_QUOTA = String(before + 100);
    try {
      await publish(ids[0]!, "y".repeat(50), "ok.txt", "Fits");
      await publish(ids[0]!, "y".repeat(50), "again.txt", "Same bytes again");
      const used = (
        (await (await call(ids[0]!, "GET", "/api/artifacts/usage")).json()) as { used: number }
      ).used;
      expect(used).toBe(before + 50);
      await expect(publish(ids[0]!, "z".repeat(200), "big.txt", "Too big")).rejects.toMatchObject({
        code: "QUOTA",
      });
    } finally {
      delete process.env.ZETTA_ARTIFACTS_QUOTA;
    }
  });
  test("a write needs a trusted origin", async () => {
    const row = await publish(ids[0]!, "x", "x.txt", "X");
    const res = await app.handle(
      new Request(`http://localhost/api/artifacts/${row.id}`, {
        method: "DELETE",
        headers: { "x-test-user": ids[0]!, origin: "http://evil.test" },
      }),
    );
    expect(res.status).toBe(403);
  });
});
