import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { desc, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { auditEvent } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";

import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { claudeArgs, lightRunsOn, type CliInput } from "../chat/harness";
import { createTestSettings } from "../settings/testing";
import { withTokenAudit } from "./cli";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `cli-a-${uuidv7()}`;

describe("a light run (claudeArgs)", () => {
  test("leaves out settings, MCP servers, slash commands and tools, and never uses --bare", () => {
    const light = claudeArgs(
      "the prompt",
      "haiku",
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      true,
    );
    expect(light).toContain("--strict-mcp-config");
    expect(light).toContain("--disable-slash-commands");
    expect(light).toContain("--tools="); // the equals form: a variadic flag must not swallow the prompt
    expect(
      light.slice(light.indexOf("--setting-sources"), light.indexOf("--setting-sources") + 2),
    ).toEqual(["--setting-sources", "project"]);
    expect(light).not.toContain("--bare"); // it reads only an API key, so a subscription login would stop working
    expect(light.at(-1)).toBe("the prompt");
    const plain = claudeArgs("the prompt", "haiku");
    for (const f of [
      "--setting-sources",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools=",
    ])
      expect(plain).not.toContain(f);
  });

  test("is off until the setting lightRuns says on, and follows a change with no restart", async () => {
    const settings = createTestSettings();
    expect(await lightRunsOn(settings.service)).toBe(false);
    await settings.set("lightRuns", "on");
    expect(await lightRunsOn(settings.service)).toBe(true);
    await settings.set("lightRuns", "off");
    expect(await lightRunsOn(settings.service)).toBe(false);
    expect(await lightRunsOn()).toBe(false); // no service: the registry default
  });
});

suite("withTokenAudit: every background learning run is written down with its tokens", () => {
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
      .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A]);
    // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
    await db.$client.end();
  });
  const rows = () =>
    db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.ownerUserId, A))
      .orderBy(desc(auditEvent.createdAt));
  const settle = async (n: number) => {
    for (let i = 0; i < 100 && (await rows()).length < n; i++) await Bun.sleep(20);
  };

  test("a run that worked records its tokens and time; one that failed records the failure and still throws", async () => {
    const ok = withTokenAudit(
      db,
      async (i: CliInput) => {
        i.onUsage?.({ input: 2, cacheRead: 650, cacheWrite: 3100, output: 40 });
        return "answer";
      },
      "batch",
    );
    expect(await ok({ harness: "claude-code", prompt: "p", model: null, userId: A })).toBe(
      "answer",
    );
    await settle(1);
    expect((await rows())[0]).toMatchObject({
      kind: "learning_run",
      outcome: "ok",
      detail: "batch",
      inputTokens: 2,
      cacheReadTokens: 650,
      cacheWriteTokens: 3100,
      outputTokens: 40,
    });
    expect((await rows())[0]!.durationMs).toBeGreaterThanOrEqual(0);

    const broken = withTokenAudit(
      db,
      async () => {
        throw new Error("engine down");
      },
      "screen",
    );
    await expect(broken({ harness: "codex", prompt: "p", model: null, userId: A })).rejects.toThrow(
      "engine down",
    );
    await settle(2);
    expect((await rows())[0]).toMatchObject({
      outcome: "failed",
      detail: "screen",
      inputTokens: null,
    });
  });

  test("a run with no person to bill it to leaves no row, and the caller's own usage hook still hears the tokens", async () => {
    const before = (await rows()).length;
    let heard = 0;
    const run = withTokenAudit(
      db,
      async (i) => {
        i.onUsage?.({ input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
        return "x";
      },
      "batch",
    );
    await run({ harness: "claude-code", prompt: "p", model: null, onUsage: () => heard++ });
    await Bun.sleep(100);
    expect(heard).toBe(1);
    expect((await rows()).length).toBe(before);
  });
});
