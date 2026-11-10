import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { ComputerError, createComputerService } from "./service";

/**
 * "Your own browser": a headless Chrome with an empty profile plays the person's running browser (one tab of theirs is open). The bot
 * works through the real agent-browser in a tab of its own; closing the session closes that tab and leaves the browser and the
 * person's tab alone. Needs the database, ZETTA_COMPUTER_TEST=1 and Google Chrome (macOS path or ZETTA_TEST_CHROME).
 */
const CHROME =
  process.env.ZETTA_TEST_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite =
  url && process.env.ZETTA_COMPUTER_TEST === "1" && existsSync(CHROME) ? describe : describe.skip;
const id = `own-${uuidv7()}`;
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e as ComputerError).code,
  );

suite("the person's own browser (real Chrome + agent-browser + database)", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const port = 20000 + Math.floor(Math.random() * 20000);
  let root: string;
  let dataDir: string;
  let chrome: ReturnType<typeof Bun.spawn> | undefined;
  let svc: ReturnType<typeof createComputerService>;
  const tabs = async () =>
    (
      (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        url: string;
      }[]
    )
      .filter((t) => t.type === "page")
      .map((t) => t.url)
      .sort();
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zetta-own-"));
    dataDir = await mkdtemp(join(tmpdir(), "zetta-own-chrome-"));
    chrome = Bun.spawn(
      [
        CHROME,
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dataDir}`,
        "--no-first-run",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    for (let i = 0; i < 50; i++) {
      if (
        await fetch(`http://127.0.0.1:${port}/json/version`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await Bun.sleep(200);
    }
    await fetch(`http://127.0.0.1:${port}/json/new?https://example.org`, { method: "PUT" }); // the person's tab
    svc = createComputerService({ db, root, allowPrivate: true, install: "local" });
    const now = new Date();
    await db.insert(user).values({
      id,
      name: id,
      email: `${id}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await svc.closeAll();
    chrome?.kill();
    await cleanupTestUsers(db, [id]);
    await rm(root, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  test("the bot works in its own tab; closing leaves the browser and the person's tabs", async () => {
    const before = await tabs();
    expect(await svc.setOwnBrowser(id, "mine", port)).toEqual({ kind: "own", cdpPort: port });
    expect((await svc.profiles(id)).find((p) => p.name === "mine")).toMatchObject({
      kind: "own",
      cdpPort: port,
    });
    const text = await svc.read(id, "mine", "https://example.com");
    expect(text).toContain("documentation examples");
    expect(await tabs()).toEqual([...before, "https://example.com/"].sort());
    await svc.close(id, "mine");
    expect(await tabs()).toEqual(before); // only the bot's tab is gone; the browser still answers
  }, 90_000);

  test("a closed port says how to turn remote debugging on", async () => {
    await svc.setOwnBrowser(id, "nothing-here", 1029);
    const e = await svc
      .start(id, "nothing-here")
      .catch((x) => x as ComputerError & { detail?: string });
    expect((e as ComputerError).code).toBe("UNAVAILABLE");
    expect(
      String((e as { detail?: string; message: string }).detail ?? (e as Error).message),
    ).toContain("remote debugging");
  }, 60_000);

  test("back to isolated, and a network install refuses the person's browser", async () => {
    expect(await svc.setOwnBrowser(id, "mine", null)).toEqual({ kind: "isolated", cdpPort: null });
    const server = createComputerService({ db, root, allowPrivate: true, install: "network" });
    expect(await code(server.setOwnBrowser(id, "mine", port))).toBe("UNSUPPORTED");
    expect(server.ownBrowser().ok).toBe(false);
    await server.closeAll();
  });
});
