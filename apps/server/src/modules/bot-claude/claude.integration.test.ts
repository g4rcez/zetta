import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { eq } from "@zetta/db/query";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { botClaudeConfig } from "@zetta/db/schema/bot-claude";
import type { CliInput } from "../chat/harness";
import { createBotClaudeRoutes } from "./routes";
import { createBotClaude } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const OWNER = `claude-${uuidv7()}`,
  OTHER = `claude-${uuidv7()}`;
const ORIGIN = "https://zetta.test";

suite("per-bot Claude Code settings against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const claude = createBotClaude(db);
  let acting = OWNER;
  const access = { requireActive: async () => ({ userId: acting }) } as never;
  const app = createBotClaudeRoutes({ access, db, claude }, [ORIGIN]);
  let a: string, b: string, codex: string;
  const mk = async (name: string, harness: "claude-code" | "codex", owner = OWNER) =>
    (
      await db
        .insert(bot)
        .values({
          ownerUserId: owner,
          name,
          slug: `t${uuidv7()
            .replace(/[^a-z]/g, "")
            .slice(-10)}`,
          kind: "specialist",
          visibility: "private",
          harness,
        })
        .returning()
    )[0]!.id;
  const req = (method: string, path: string, body?: unknown, origin: string | null = ORIGIN) =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const skill = {
    kind: "skill",
    name: "release-notes",
    description: "Write release notes",
    body: "Summarise merged PRs.",
  };

  beforeAll(async () => {
    const now = new Date();
    for (const id of [OWNER, OTHER])
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    a = await mk("Claude A", "claude-code");
    b = await mk("Claude B", "claude-code");
    codex = await mk("Codex C", "codex");
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [OWNER, OTHER]);
    await db.$client.end();
  });

  test("a bot with no settings has no profile, so it runs exactly as before", async () => {
    expect(await claude.profile(a)).toBeUndefined();
    const r = await req("GET", `/bots/${a}/claude`);
    const body = (await r.json()) as { config: { preset: string }; assets: unknown[] };
    expect(r.status).toBe(200);
    expect(body.config.preset).toBe("auto");
    expect(body.assets).toEqual([]);
  });

  test("saving settings and installing items for one bot never touches another bot", async () => {
    const cfg = {
      preset: "read_only",
      allow: ["WebFetch"],
      deny: ["Bash(rm:*)"],
      appendPrompt: "Be terse",
      effort: "high",
      maxBudgetCents: 300,
    };
    expect((await req("PUT", `/bots/${a}/claude`, cfg)).status).toBe(200);
    expect((await req("POST", `/bots/${a}/claude/assets`, skill)).status).toBe(200);
    expect(
      (
        await req("POST", `/bots/${a}/claude/assets`, {
          kind: "agent",
          name: "reviewer",
          description: "Reviews diffs",
          body: "Review.",
          tools: ["Read"],
          model: "haiku",
        })
      ).status,
    ).toBe(200);
    const pa = await claude.profile(a);
    expect(pa).toMatchObject({
      preset: "read_only",
      allow: ["WebFetch"],
      deny: ["Bash(rm:*)"],
      appendPrompt: "Be terse",
      effort: "high",
      maxBudgetCents: 300,
    });
    expect(Object.keys(pa!.files).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "agents/reviewer.md",
      "skills/release-notes/SKILL.md",
    ]);
    expect(await claude.profile(b)).toBeUndefined();
  });

  test("duplicates, bad input and a missing id are refused with clear errors", async () => {
    expect((await req("POST", `/bots/${a}/claude/assets`, skill)).status).toBe(409);
    expect(
      (await req("POST", `/bots/${a}/claude/assets`, { ...skill, name: "Bad Name" })).status,
    ).toBe(400);
    expect(
      (await req("POST", `/bots/${a}/claude/assets`, { ...skill, name: "x", body: "!`id`" }))
        .status,
    ).toBe(400);
    expect(
      (
        await req("PUT", `/bots/${a}/claude`, {
          preset: "auto",
          allow: ["Bash\nBash"],
          deny: [],
          appendPrompt: "",
          effort: null,
          maxBudgetCents: null,
        })
      ).status,
    ).toBe(400);
    expect((await req("DELETE", `/bots/${a}/claude/assets/${uuidv7()}`)).status).toBe(404);
  });

  test("edit, switch off and remove", async () => {
    const list = (
      (await (await req("GET", `/bots/${a}/claude`)).json()) as {
        assets: { id: string; kind: string; name: string }[];
      }
    ).assets;
    const s = list.find((x) => x.kind === "skill")!;
    expect(
      (
        await req("PUT", `/bots/${a}/claude/assets/${s.id}`, {
          ...skill,
          body: "Changed.",
          enabled: false,
        })
      ).status,
    ).toBe(200);
    expect(Object.keys((await claude.profile(a))!.files)).not.toContain(
      "skills/release-notes/SKILL.md",
    );
    expect((await req("DELETE", `/bots/${a}/claude/assets/${s.id}`)).status).toBe(200);
    expect((await claude.get(a)).assets.map((x) => x.name)).toEqual(["reviewer"]);
  });

  test("only the owner, and only from the trusted origin", async () => {
    acting = OTHER;
    for (const r of [
      await req("GET", `/bots/${a}/claude`),
      await req("PUT", `/bots/${a}/claude`, {
        preset: "full",
        allow: [],
        deny: [],
        appendPrompt: "",
        effort: null,
        maxBudgetCents: null,
      }),
      await req("POST", `/bots/${a}/claude/assets`, skill),
    ])
      expect(r.status).toBe(404);
    acting = OWNER;
    expect(
      (
        await req(
          "PUT",
          `/bots/${a}/claude`,
          {
            preset: "full",
            allow: [],
            deny: [],
            appendPrompt: "",
            effort: null,
            maxBudgetCents: null,
          },
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          "PUT",
          `/bots/${a}/claude`,
          {
            preset: "full",
            allow: [],
            deny: [],
            appendPrompt: "",
            effort: null,
            maxBudgetCents: null,
          },
          null,
        )
      ).status,
    ).toBe(403);
    expect((await claude.get(a)).config.preset).toBe("read_only");
  });

  test("a turn passes the bot's own profile to the CLI, only for Claude Code bots", async () => {
    const seen: CliInput[] = [];
    const run = createTurnRunner(db, async (i) => {
      seen.push(i);
      return "ok";
    });
    const row = async (id: string) => (await db.select().from(bot).where(eq(bot.id, id)))[0]!;
    await run({ userId: OWNER, bot: await row(a), history: [], prompt: "hi" });
    await run({ userId: OWNER, bot: await row(b), history: [], prompt: "hi" });
    await run({ userId: OWNER, bot: await row(codex), history: [], prompt: "hi" });
    expect(seen[0]!.profile).toMatchObject({ preset: "read_only", appendPrompt: "Be terse" });
    expect(Object.keys(seen[0]!.profile!.files)).toContain("agents/reviewer.md");
    // A Claude Code bot without settings gets Zetta's own skills and nothing else; other harnesses get no profile.
    expect(seen[1]!.profile).toMatchObject({
      preset: "auto",
      allow: [],
      deny: [],
      appendPrompt: "",
    });
    expect(Object.keys(seen[1]!.profile!.files).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "skills/zetta-long-running-work/SKILL.md",
      "skills/zetta-recover-from-failure/SKILL.md",
      "skills/zetta-verify-before-done/SKILL.md",
    ]);
    expect(seen[2]!.profile).toBeUndefined();
  });

  test("every new bot, and the chief, owns its settings row from the start; the backfill covers older bots", async () => {
    const actor = { userId: OWNER } as never;
    const svc = createChatService(db, (async () => "ok") as never);
    const created = (await svc.createBot(actor, { name: "Fresh bot", harness: "claude-code" }))!;
    const chief = (await svc.ensureChief(actor))!;
    for (const id of [created.id, chief.id])
      expect(
        (await db.select().from(botClaudeConfig).where(eq(botClaudeConfig.botId, id))).map(
          (r) => r.preset,
        ),
      ).toEqual(["auto"]);
    // A bot from before this feature has no row; the migration's statement gives it one without touching rows that exist.
    await db
      .update(botClaudeConfig)
      .set({ preset: "edit" })
      .where(eq(botClaudeConfig.botId, created.id));
    await db.delete(botClaudeConfig).where(eq(botClaudeConfig.botId, chief.id));
    await db.$client.query(
      'INSERT INTO "bot_claude_config" ("bot_id") SELECT "id" FROM "bot" WHERE owner_user_id = $1 ON CONFLICT ("bot_id") DO NOTHING',
      [OWNER],
    );
    const rows = await db.select().from(botClaudeConfig).where(eq(botClaudeConfig.botId, chief.id));
    expect(rows.map((r) => r.preset)).toEqual(["auto"]);
    expect(
      (await db.select().from(botClaudeConfig).where(eq(botClaudeConfig.botId, created.id)))[0]!
        .preset,
    ).toBe("edit");
  });
});
