import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botSkill, skill, skillUse } from "@zetta/db/schema/skills";
import { eq } from "@zetta/db/query";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { withBuiltinSkills } from "../bot-claude/profile";
import { createBotClaude } from "../bot-claude/store";
import { hermesPrompt } from "../chat/harness";
import { createIdentityAccess, issueBackgroundActor } from "../identity/access";
import { checkUpdates, updateFromSource } from "./install";
import { createMarket } from "./market";
import { botSkillOverview } from "./overview";
import { createSkillRoutes } from "./routes";
import { createSkills, SKILL_LIMITS, skillFields, SkillError } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`skm-a-${uuidv7()}`, `skm-b-${uuidv7()}`];
const ORIGIN = "http://localhost:5173";

suite("skill management, against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const skills = createSkills(db);
  const claude = createBotClaude(db);
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
  const server = new Elysia().use(
    createSkillRoutes(
      {
        access,
        db,
        skills,
        market: createMarket({ fetch: (async () => new Response("{}")) as never } as never),
        claude,
      },
      [ORIGIN],
    ),
  );
  const http = async (as: string, method: string, path: string, body?: unknown) => {
    const res = await server.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "x-test-user": as, origin: ORIGIN, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  let a: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let b: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let bot1: string, bot2: string;
  const make = (name: string, body = "do the thing", description = `use ${name}`, actor = a) =>
    skills.create(actor, { name, description, body });
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as SkillError;
    }
    throw new Error("expected a failure");
  };
  const newBot = async (owner: string, name: string, harness = "claude-code") => {
    const [row] = await db
      .insert(bot)
      .values({
        ownerUserId: owner,
        name,
        slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
        kind: "specialist",
        visibility: "private",
        harness,
      } as never)
      .returning({ id: bot.id });
    return row!.id;
  };

  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active" as const, joinedAt: now, updatedAt: now });
    }
    a = (await issueBackgroundActor(async () => ({ isAdmin: false }), A))!;
    b = (await issueBackgroundActor(async () => ({ isAdmin: false }), B))!;
    bot1 = await newBot(A, "Alpha");
    bot2 = await newBot(A, "Beta");
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  describe("the list", () => {
    test("search, source, bot, sort and the size of the text", async () => {
      const pdf = await make("pdf-tools", "x".repeat(2000), "Make PDFs");
      const mail = await make("mail-triage", "y".repeat(300), "Sort email");
      await skills.setBots(a, mail.id, [bot1]);
      const names = async (o = {}) => (await skills.list(a, "mine", o)).map((s) => s.name);
      expect(await names({ q: "pdf" })).toEqual(["pdf-tools"]);
      expect(await names({ q: "SORT EMAIL" })).toEqual(["mail-triage"]);
      expect(await names({ q: "100%_" })).toEqual([]);
      expect(await names({ source: "github" })).toEqual([]);
      expect(await names({ botId: bot1 })).toEqual(["mail-triage"]);
      expect(await names({ sort: "name" })).toEqual(["mail-triage", "pdf-tools"]);
      expect(await names({ sort: "size" })).toEqual(["pdf-tools", "mail-triage"]);
      const row = (await skills.list(a, "mine", { q: "pdf" }))[0]!;
      expect(row).toMatchObject({
        bodyBytes: 2000,
        uses30d: 0,
        lastUsedAt: null,
        status: "active",
      });
      expect(pdf.id).toBe(row.id);
      // Other people see none of it.
      expect(await skills.list(b, "mine", { q: "pdf" })).toEqual([]);
    });
  });

  describe("usage", () => {
    test("a skill picked or loaded by a bot it is attached to is counted; anything else is ignored", async () => {
      const s = await make("used-skill");
      await skills.setBots(a, s.id, [bot1]);
      expect(await skills.recordUse(bot1, ["used-skill", "not-a-skill"], "picked")).toBe(1);
      expect(await skills.recordUse(bot1, ["used-skill"], "run")).toBe(1);
      // Not attached to this bot: not counted.
      expect(await skills.recordUse(bot2, ["used-skill"], "picked")).toBe(0);
      expect(await skills.recordUse(bot1, [], "picked")).toBe(0);
      const row = (await skills.list(a, "mine", { q: "used-skill" }))[0]!;
      expect(row.uses30d).toBe(2);
      expect(row.lastUsedAt).toBeInstanceOf(Date);
    });
    test("Unused lists what nobody used in 30 days; sorting by use puts the newest first", async () => {
      const unused = (await skills.list(a, "mine", { unused: true })).map((r) => r.name);
      expect(unused).toContain("pdf-tools");
      expect(unused).not.toContain("used-skill");
      const [first] = await skills.list(a, "mine", { sort: "used" });
      expect(first!.name).toBe("used-skill");
      // Use older than 30 days is not "recent" but is still the last use.
      const [old] = await skills.list(a, "mine", { q: "pdf-tools" });
      await db.insert(skillUse).values({
        skillId: old!.id,
        botId: bot1,
        source: "run",
        usedAt: new Date(Date.now() - 40 * 86_400_000),
      });
      const again = (await skills.list(a, "mine", { q: "pdf-tools" }))[0]!;
      expect(again.uses30d).toBe(0);
      expect(again.lastUsedAt).toBeInstanceOf(Date);
      expect((await skills.list(a, "mine", { unused: true })).map((r) => r.name)).toContain(
        "pdf-tools",
      );
    });
    test("use older than 90 days is dropped the next time the skill is used", async () => {
      const [s] = await skills.list(a, "mine", { q: "used-skill" });
      await db.insert(skillUse).values({
        skillId: s!.id,
        botId: bot1,
        source: "run",
        usedAt: new Date(Date.now() - 100 * 86_400_000),
      });
      await skills.recordUse(bot1, ["used-skill"], "picked");
      const left = await db.select().from(skillUse).where(eq(skillUse.skillId, s!.id));
      expect(left.every((r) => r.usedAt.getTime() > Date.now() - 91 * 86_400_000)).toBe(true);
    });
  });

  describe("archive and restore", () => {
    test("an archived skill is listed on its own, and restoring it brings its bots back", async () => {
      const s = await make("comes-back");
      await skills.setBots(a, s.id, [bot1, bot2]);
      await skills.archive(a, s.id);
      expect((await skills.list(a, "mine")).map((r) => r.name)).not.toContain("comes-back");
      const archived = await skills.list(a, "mine", { status: "archived" });
      expect(archived.map((r) => r.name)).toContain("comes-back");
      expect(archived.find((r) => r.name === "comes-back")!.status).toBe("archived");
      const back = await skills.restore(a, s.id);
      expect(back).toMatchObject({
        name: "comes-back",
        botIds: expect.arrayContaining([bot1, bot2]),
      });
      expect(await fails(skills.restore(a, s.id))).toMatchObject({ code: "NOT_FOUND" });
    });
    test("a name another skill took since is refused; someone else's skill is not found", async () => {
      const s = await make("name-taken");
      await skills.archive(a, s.id);
      await make("name-taken", "new one");
      expect(await fails(skills.restore(a, s.id))).toMatchObject({ code: "DUPLICATE" });
      const other = await make("b-private", "x", "d", b);
      await skills.archive(b, other.id);
      expect(await fails(skills.restore(a, other.id))).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("bulk", () => {
    test("attach and detach several skills to several bots at once", async () => {
      const x = await make("bulk-x"),
        y = await make("bulk-y");
      const r = await skills.bulk(a, {
        action: "attach",
        skillIds: [x.id, y.id],
        botIds: [bot1, bot2],
      });
      expect(r).toEqual({ changed: 4, skippedBots: [] });
      expect((await skills.get(a, x.id)).botIds.sort()).toEqual([bot1, bot2].sort());
      // Doing it again changes nothing.
      expect(
        await skills.bulk(a, { action: "attach", skillIds: [x.id, y.id], botIds: [bot1, bot2] }),
      ).toEqual({ changed: 0, skippedBots: [] });
      await skills.bulk(a, { action: "detach", skillIds: [x.id], botIds: [bot1] });
      expect((await skills.get(a, x.id)).botIds).toEqual([bot2]);
      expect((await skills.get(a, y.id)).botIds.sort()).toEqual([bot1, bot2].sort());
    });
    test("archive several at once", async () => {
      const p = await make("bulk-p"),
        q = await make("bulk-q");
      expect(await skills.bulk(a, { action: "archive", skillIds: [p.id, q.id] })).toMatchObject({
        changed: 2,
      });
      const names = (await skills.list(a, "mine")).map((r) => r.name);
      expect(names).not.toContain("bulk-p");
      expect(names).not.toContain("bulk-q");
    });
    test("a bot that would pass its limit is skipped and named; the others still get the skills", async () => {
      const full = await newBot(A, "Full");
      const free = await newBot(A, "Free");
      const [first] = await skills.list(a, "mine", { q: "bulk-y" });
      const filler = Array.from({ length: SKILL_LIMITS.perBot }, (_, i) => ({
        ownerUserId: A,
        name: `filler-${i}`,
        description: "d",
        body: "b",
      }));
      const rows = await db.insert(skill).values(filler).returning({ id: skill.id });
      await db.insert(botSkill).values(rows.map((r) => ({ botId: full, skillId: r.id })));
      const r = await skills.bulk(a, {
        action: "attach",
        skillIds: [first!.id],
        botIds: [full, free],
      });
      expect(r).toEqual({ changed: 1, skippedBots: [full] });
      expect((await skills.get(a, first!.id)).botIds).toContain(free);
      expect((await skills.get(a, first!.id)).botIds).not.toContain(full);
    });
    test("anything that is not the caller's stops the whole change", async () => {
      const mine = await make("bulk-mine");
      const theirs = await make("bulk-theirs", "x", "d", b);
      const theirBot = await newBot(B, "Theirs");
      expect(
        await fails(
          skills.bulk(a, { action: "attach", skillIds: [mine.id, theirs.id], botIds: [bot1] }),
        ),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(
        await fails(
          skills.bulk(a, { action: "attach", skillIds: [mine.id], botIds: [bot1, theirBot] }),
        ),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(await fails(skills.bulk(a, { action: "attach", skillIds: [mine.id] }))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await skills.get(a, mine.id)).botIds).toEqual([]);
    });
  });

  describe("what a bot has", () => {
    test("every source is shown with its size; a library skill hidden by the bot's own is marked", async () => {
      const id = await newBot(A, "Overview");
      const lib = await make("overview-lib", "L".repeat(500));
      const hidden = await make("overview-same", "from the library");
      await skills.setBots(a, lib.id, [id]);
      await skills.setBots(a, hidden.id, [id]);
      await claude.addAsset(id, {
        kind: "skill",
        name: "overview-same",
        description: "mine",
        body: "bot own text",
        tools: [],
        model: null,
        enabled: true,
      });
      await claude.addAsset(id, {
        kind: "skill",
        name: "overview-own",
        description: "mine too",
        body: "own",
        tools: [],
        model: null,
        enabled: true,
      });
      const o = await botSkillOverview(db, claude, { id, harness: "claude-code" });
      const by = (n: string) => o.skills.filter((s) => s.name === n);
      expect(by("overview-lib")[0]).toMatchObject({
        source: "library",
        skillId: lib.id,
        bytes: 500,
        hiddenBy: null,
        unusable: false,
        fits: null,
      });
      expect(by("overview-own")[0]).toMatchObject({ source: "bot", skillId: null });
      expect(
        by("overview-same")
          .map((s) => s.source)
          .sort(),
      ).toEqual(["bot", "library"]);
      expect(by("overview-same").find((s) => s.source === "library")).toMatchObject({
        hiddenBy: "bot",
        skillId: hidden.id,
      });
      expect(o.skills.some((s) => s.source === "builtin")).toBe(true);
      expect(o.budget).toBeNull();
    });
    test("on Hermes the budget shows what no longer fits, and it is the same skills hermesPrompt leaves out", async () => {
      const id = await newBot(A, "Hermes", "hermes");
      const big = [
        await make("budget-a", "alpha text. ".repeat(3000)),
        await make("budget-b", "bravo text. ".repeat(3000)),
        await make("budget-c", "charlie text. ".repeat(80)),
      ];
      await skills.setBots(a, big[0]!.id, [id]);
      await skills.setBots(a, big[1]!.id, [id]);
      await skills.setBots(a, big[2]!.id, [id]);
      const o = await botSkillOverview(db, claude, { id, harness: "hermes" });
      expect(o.budget).toMatchObject({ limit: 48_000 });
      expect(o.budget!.dropped).toBeGreaterThan(0);
      const prompt = hermesPrompt("hi", withBuiltinSkills(await claude.profile(id)));
      for (const s of o.skills.filter((r) => r.fits !== null))
        expect(prompt.includes(`## Skill: ${s.name}\n`)).toBe(s.fits as boolean);
      expect(o.skills.find((s) => s.name === "budget-b")!.fits).toBe(false);
      expect(o.skills.find((s) => s.name === "budget-c")!.fits).toBe(true);
      expect(o.budget!.used).toBeLessThanOrEqual(48_000);
    });
  });

  describe("history", () => {
    test("every save is kept, newest first, with who saved it; the first is the creation", async () => {
      const s = await make("history-skill", "version one", "first description");
      const s2 = await skills.update(a, s.id, s.version, { body: "version two" });
      const s3 = await skills.update(a, s.id, s2.version, {
        description: "second description",
        body: "version three",
      });
      const h = await skills.history(a, s.id);
      expect(h.currentVersion).toBe(s3.version);
      expect(h.revisions.map((r) => r.version)).toEqual([s3.version, s2.version, s.version]);
      expect(h.revisions[2]).toMatchObject({
        name: "history-skill",
        description: "first description",
        bodyBytes: 11,
        savedBy: A,
      });
      const first = await skills.revision(a, s.id, h.revisions[2]!.id);
      expect(first.body).toBe("version one");
    });
    test("going back puts the old text back as a new save; the history keeps both", async () => {
      const s = await make("revert-skill", "original");
      const changed = await skills.update(a, s.id, s.version, { body: "changed" });
      const h = await skills.history(a, s.id);
      const original = h.revisions.find((r) => r.version === s.version)!;
      const back = await skills.revert(a, s.id, original.id, changed.version);
      expect(back.body).toBe("original");
      expect(back.version).toBe(changed.version + 1);
      expect((await skills.history(a, s.id)).revisions.map((r) => r.version)).toEqual([
        back.version,
        changed.version,
        s.version,
      ]);
      // A stale page cannot revert over someone's newer save.
      expect(await fails(skills.revert(a, s.id, original.id, changed.version))).toMatchObject({
        code: "CONFLICT",
      });
    });
    test("only the owner reads or reverts it; a revision of another skill is not found", async () => {
      const s = await make("private-history");
      const other = await make("other-history");
      const h = await skills.history(a, s.id);
      expect(await fails(skills.history(b, s.id))).toMatchObject({ code: "NOT_FOUND" });
      expect(await fails(skills.revision(b, s.id, h.revisions[0]!.id))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await fails(skills.revision(a, other.id, h.revisions[0]!.id))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await fails(skills.revert(b, s.id, h.revisions[0]!.id, s.version))).toMatchObject({
        code: "NOT_FOUND",
      });
    });
    test("only the last 50 saves are kept", async () => {
      const s = await make("many-saves");
      let v = s.version;
      for (let i = 0; i < 52; i++)
        v = (await skills.update(a, s.id, v, { body: `text ${i}` })).version;
      const { revisions } = await skills.history(a, s.id);
      expect(revisions).toHaveLength(50);
      expect(revisions[0]!.version).toBe(v);
    });
    test("a skill installed from GitHub that the owner changes is marked edited", async () => {
      const gh = await skills.create(
        a,
        { name: "from-github", description: "d", body: "upstream" },
        { repo: "acme/skills", path: "skills/x/SKILL.md", ref: "1".repeat(40) },
      );
      const [row] = await db
        .select({ s: skill.sourceState })
        .from(skill)
        .where(eq(skill.id, gh.id));
      expect(row!.s).toBe("pristine");
      await skills.update(a, gh.id, gh.version, { body: "mine now" });
      const [after] = await db
        .select({ s: skill.sourceState })
        .from(skill)
        .where(eq(skill.id, gh.id));
      expect(after!.s).toBe("edited");
    });
    test("the routes: history, one save, and going back", async () => {
      const s = await make("api-history");
      const changed = await skills.update(a, s.id, s.version, { body: "later" });
      const h = await http(A, "GET", `/api/skills/${s.id}/history`);
      expect(h.json.history.revisions).toHaveLength(2);
      const rid = h.json.history.revisions[1].id;
      expect(
        (await http(A, "GET", `/api/skills/${s.id}/revisions/${rid}`)).json.revision.body,
      ).toBe("do the thing");
      expect((await http(B, "GET", `/api/skills/${s.id}/history`)).status).toBe(404);
      const r = await http(A, "POST", `/api/skills/${s.id}/revert`, {
        revisionId: rid,
        expectedVersion: changed.version,
      });
      expect(r.status).toBe(200);
      expect(r.json.skill.body).toBe("do the thing");
      expect(
        (
          await http(A, "POST", `/api/skills/${s.id}/revert`, {
            revisionId: rid,
            expectedVersion: 1,
          })
        ).status,
      ).toBe(409);
    });
  });

  describe("the folder of a skill", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    test("files are added, replaced and removed; each change is a save and the folder is listed", async () => {
      const s = await make("folder-skill");
      const files = await skills.saveFiles(a, s.id, [
        { path: "scripts/run.sh", content: enc("echo hi"), mode: "executable" },
        { path: "notes.md", content: enc("# notes"), mode: "file" },
      ]);
      expect(files.map((f) => `${f.path}:${f.mode}`)).toEqual([
        "notes.md:file",
        "scripts/run.sh:executable",
      ]);
      const replaced = await skills.saveFiles(a, s.id, [
        { path: "notes.md", content: enc("# new notes"), mode: "file" },
      ]);
      expect(replaced.find((f) => f.path === "notes.md")!.size).toBe(11);
      const left = await skills.saveFiles(a, s.id, [], ["scripts/run.sh"]);
      expect(left.map((f) => f.path)).toEqual(["notes.md"]);
      const h = await skills.history(a, s.id);
      expect(h.revisions.length).toBe(4);
      // The folder changed between saves, and the history can tell without keeping the files.
      expect(new Set(h.revisions.map((r) => r.filesHash)).size).toBe(4);
      expect((await skills.get(a, s.id)).version).toBe(s.version + 3);
    });
    test("a file is read back as text, or as base64 when it is not text", async () => {
      const s = await make("folder-read");
      await skills.saveFiles(a, s.id, [
        { path: "a.txt", content: enc("héllo"), mode: "file" },
        { path: "logo.png", content: new Uint8Array([0x89, 0x50, 0xff, 0xfe, 0x00]), mode: "file" },
      ]);
      expect(await skills.readFile(a, s.id, "a.txt")).toMatchObject({
        encoding: "utf8",
        content: "héllo",
      });
      const bin = await skills.readFile(a, s.id, "logo.png");
      expect(bin).toMatchObject({ encoding: "base64", size: 5 });
      expect(Buffer.from(bin.content, "base64")).toEqual(
        Buffer.from([0x89, 0x50, 0xff, 0xfe, 0x00]),
      );
      expect(await fails(skills.readFile(a, s.id, "missing.txt"))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await fails(skills.readFile(b, s.id, "a.txt"))).toMatchObject({ code: "NOT_FOUND" });
    });
    test("a bad path, a credential, a file over 1 MB, too many files: refused with the reason, and nothing is written", async () => {
      const s = await make("folder-limits");
      const bad = async (path: string) =>
        (await fails(
          skills.saveFiles(a, s.id, [{ path, content: enc("x"), mode: "file" }]),
        )) as SkillError;
      for (const path of ["../x", "/abs", "a//b", "SKILL.md", "a/./b", "x\u0000y", "a".repeat(301)])
        expect((await bad(path)).code).toBe("INVALID");
      expect(
        (
          (await fails(
            skills.saveFiles(a, s.id, [
              { path: "key.env", content: enc("KEY=sk-test-abcdefghijklmnop1234"), mode: "file" },
            ]),
          )) as SkillError
        ).code,
      ).toBe("SECRET_REJECTED");
      const big = (await fails(
        skills.saveFiles(a, s.id, [
          { path: "big.bin", content: new Uint8Array(1_000_001), mode: "file" },
        ]),
      )) as SkillError;
      expect(big).toMatchObject({ code: "TOO_LARGE" });
      expect(big.detail).toContain("big.bin");
      const many = Array.from({ length: 201 }, (_, i) => ({
        path: `f${i}.txt`,
        content: enc("x"),
        mode: "file" as const,
      }));
      expect(((await fails(skills.saveFiles(a, s.id, many))) as SkillError).code).toBe("TOO_LARGE");
      expect((await skills.get(a, s.id)).files).toEqual([]);
      expect((await skills.get(a, s.id)).version).toBe(s.version);
    });
    test("only the owner changes the folder; an installed skill becomes edited", async () => {
      const s = await make("folder-owner");
      expect(
        (
          (await fails(
            skills.saveFiles(b, s.id, [{ path: "x.txt", content: enc("x"), mode: "file" }]),
          )) as SkillError
        ).code,
      ).toBe("NOT_FOUND");
      const gh = await skills.create(
        a,
        { name: "folder-gh", description: "d", body: "b" },
        { repo: "acme/tools", path: "t/SKILL.md", ref: "3".repeat(40) },
      );
      await skills.saveFiles(a, gh.id, [{ path: "x.txt", content: enc("x"), mode: "file" }]);
      const [row] = await db
        .select({ st: skill.sourceState })
        .from(skill)
        .where(eq(skill.id, gh.id));
      expect(row!.st).toBe("edited");
    });
    test("the routes: write text and base64, read, remove, and a bad request", async () => {
      const s = await make("folder-api");
      const put = await http(A, "PUT", `/api/skills/${s.id}/files`, {
        files: [
          { path: "docs/a.md", content: "# a" },
          {
            path: "bin/tool",
            content: Buffer.from([1, 2, 3, 255]).toString("base64"),
            encoding: "base64",
            mode: "executable",
          },
        ],
      });
      expect(put.status).toBe(200);
      expect(put.json.files.map((f: any) => f.path)).toEqual(["bin/tool", "docs/a.md"]);
      expect(
        (await http(A, "GET", `/api/skills/${s.id}/file?path=docs%2Fa.md`)).json.file,
      ).toMatchObject({ encoding: "utf8", content: "# a" });
      expect((await http(B, "GET", `/api/skills/${s.id}/file?path=docs%2Fa.md`)).status).toBe(404);
      expect(
        (
          await http(A, "PUT", `/api/skills/${s.id}/files`, {
            files: [{ path: "../x", content: "x" }],
          })
        ).status,
      ).toBe(400);
      expect((await http(A, "PUT", `/api/skills/${s.id}/files`, { files: [] })).status).toBe(400);
      const removed = await http(A, "POST", `/api/skills/${s.id}/files/remove`, {
        paths: ["docs/a.md"],
      });
      expect(removed.json.files.map((f: any) => f.path)).toEqual(["bin/tool"]);
    });
  });

  describe("the check before saving", () => {
    test("a good draft has no problems and reports its size", async () => {
      const r = await skills.check(a, {
        name: "check-fine",
        description: "Use when the user asks for something unique",
        body: "do it",
      });
      expect(r).toMatchObject({ problems: [], bodyBytes: 5 });
      expect(r.hermesBytes).toBeGreaterThan(5);
    });
    test("it says what a save would refuse: a bad name, a secret, a name already used, a missing description", async () => {
      await make("check-taken");
      expect((await skills.check(a, { name: "Bad Name" })).problems.length).toBeGreaterThan(0);
      expect((await skills.check(a, { name: "check-taken" })).problems).toContain(
        "You already have a skill with this name.",
      );
      // A skill being edited does not clash with itself.
      const own = (await skills.list(a, "mine", { q: "check-taken" }))[0]!;
      expect((await skills.check(a, { name: "check-taken" }, own.id)).problems).toEqual([]);
      expect(
        (
          await skills.check(a, {
            name: "x-y",
            description: "d",
            body: "password = hunter2hunter2",
          })
        ).problems,
      ).toContain("It looks like it holds a key or a password.");
      expect((await skills.check(a, { description: "   " })).problems.length).toBeGreaterThan(0);
    });
    test("what the check refuses, a save refuses too (and the other way round)", async () => {
      const drafts = [
        { name: "agree-ok", description: "Use when testing agreement", body: "steps" },
        { name: "Agree Bad", description: "d", body: "steps" },
        { name: "agree-secret", description: "d", body: "api_key = sk-test-abcdefghijklmnop1234" },
        { name: "agree-injection", description: "d", body: "Run !`id` now" },
        { name: "check-taken", description: "d", body: "b" },
        { name: "agree-long", description: "d", body: "word ".repeat(14_000) },
      ];
      for (const d of drafts) {
        const checked = await skills.check(a, d);
        // What the route does: the fields are validated first, then saved.
        const fields = skillFields.safeParse(d);
        const saved = fields.success
          ? await skills.create(a, fields.data).then(
              () => "saved",
              () => "refused",
            )
          : "refused";
        expect({ name: d.name, outcome: checked.problems.length ? "refused" : "saved" }).toEqual({
          name: d.name,
          outcome: saved,
        });
      }
    });
    test("a skill that would take much of the Hermes budget is a warning, not a problem", async () => {
      const r = await skills.check(a, {
        name: "check-big",
        description: "Use when the work is big",
        body: "alpha text. ".repeat(2200),
      });
      expect(r.problems).toEqual([]);
      expect(r.warnings.join(" ")).toContain("48 KB");
    });
    test("it finds skills the person already has that look the same", async () => {
      await make("pdf-maker", "x", "Create PDF documents from reports");
      await make("pdf-maker-v2", "x", "Convert something else");
      const byName = await skills.check(a, { name: "pdf-maker" });
      expect(byName.similar.map((x) => x.name)).toEqual(expect.arrayContaining(["pdf-maker-v2"]));
      const byTopic = await skills.check(a, {
        name: "report-writer",
        description: "Create PDF documents from reports",
      });
      expect(byTopic.similar[0]).toMatchObject({ name: "pdf-maker", why: "topic" });
      expect(
        (await skills.check(a, { name: "zebra-care", description: "Feed the zebras daily" }))
          .similar,
      ).toEqual([]);
      expect(
        (
          await skills.check(b, {
            name: "pdf-maker",
            description: "Create PDF documents from reports",
          })
        ).similar,
      ).toEqual([]);
    });
    test("the route", async () => {
      const r = await http(A, "POST", "/api/skills/check", {
        name: "check-taken",
        description: "d",
      });
      expect(r.status).toBe(200);
      expect(r.json.check.problems).toContain("You already have a skill with this name.");
      expect((await http(A, "POST", "/api/skills/check", { name: 5 })).status).toBe(400);
    });
  });

  describe("updates from GitHub", () => {
    const SHA = (n: number) => String(n).repeat(40).slice(0, 40);
    const upstream = {
      sha: SHA(1),
      exists: true,
      status: 200,
      files: {} as Record<string, string>,
    };
    const skillMd = (body: string) => `---\ndescription: Upstream description\n---\n${body}`;
    const github = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (upstream.status !== 200) return new Response("limited", { status: upstream.status });
      const api = /^\/repos\/([^/]+\/[^/]+)\/(commits\/HEAD|git\/trees\/[0-9a-f]{40})$/.exec(
        url.pathname,
      );
      if (url.hostname === "api.github.com" && api) {
        if (!upstream.exists || api[1] !== "acme/tools")
          return new Response("not found", { status: 404 });
        if (api[2] === "commits/HEAD") return new Response(upstream.sha);
        return Response.json({
          tree: Object.entries(upstream.files).map(([path, c]) => ({
            path,
            type: "blob",
            mode: "100644",
            size: Buffer.byteLength(c),
          })),
        });
      }
      const raw = /^\/acme\/tools\/([0-9a-f]{40})\/(.+)$/.exec(url.pathname);
      if (raw && raw[1] === upstream.sha && upstream.files[raw[2]!] !== undefined)
        return new Response(upstream.files[raw[2]!]);
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const fresh = () => ({ skills, market: createMarket({ fetch: github, suggestions: [] }) });
    const PATH = "tools/x/SKILL.md";
    let id: string;

    test("a skill whose repository did not move is current; one whose repository moved but whose own files did not is current too", async () => {
      upstream.sha = SHA(1);
      upstream.exists = true;
      upstream.status = 200;
      upstream.files = { [PATH]: skillMd("first body"), "tools/x/run.sh": "echo one" };
      const made = await skills.create(
        a,
        { name: "gh-tool", description: "Upstream description", body: "first body" },
        { repo: "acme/tools", path: PATH, ref: SHA(1) },
        [{ path: "run.sh", content: new TextEncoder().encode("echo one"), size: 8, mode: "file" }],
      );
      id = made.id;
      const one = await checkUpdates(fresh(), a);
      expect(one.find((u) => u.id === id)).toMatchObject({
        state: "current",
        installedRef: SHA(1),
        latestRef: SHA(1),
        edited: false,
      });
      upstream.sha = SHA(2);
      upstream.files["README.md"] = "unrelated change";
      expect((await checkUpdates(fresh(), a)).find((u) => u.id === id)).toMatchObject({
        state: "current",
        latestRef: SHA(2),
      });
    });

    test("a real change is an update; applying it replaces the text and the folder and keeps the old text in the history", async () => {
      upstream.sha = SHA(3);
      upstream.files = {
        [PATH]: skillMd("second body"),
        "tools/x/run.sh": "echo two",
        "tools/x/new.md": "new file",
      };
      const found = (await checkUpdates(fresh(), a)).find((u) => u.id === id)!;
      expect(found).toMatchObject({ state: "update", latestRef: SHA(3), edited: false });
      const updated = await updateFromSource(fresh(), a, id, { ref: found.latestRef });
      expect(updated).toMatchObject({ body: "second body", sourceRef: SHA(3), name: "gh-tool" });
      expect(updated.files.map((f) => f.path)).toEqual(["new.md", "run.sh"]);
      const h = await skills.history(a, id);
      expect(h.revisions.length).toBeGreaterThanOrEqual(2);
      expect((await skills.revision(a, id, h.revisions[1]!.id)).body).toBe("first body");
      expect((await checkUpdates(fresh(), a)).find((u) => u.id === id)!.state).toBe("current");
    });

    test("a skill the owner edited asks before it is overwritten, and the owner's text stays in the history", async () => {
      const mine = await skills.get(a, id);
      await skills.update(a, id, mine.version, { body: "my own changes" });
      upstream.sha = SHA(4);
      upstream.files[PATH] = skillMd("third body");
      const found = (await checkUpdates(fresh(), a)).find((u) => u.id === id)!;
      expect(found).toMatchObject({ state: "update", edited: true });
      expect(await fails(updateFromSource(fresh(), a, id, { ref: SHA(4) }))).toMatchObject({
        code: "EDITED",
      });
      expect((await skills.get(a, id)).body).toBe("my own changes");
      const done = await updateFromSource(fresh(), a, id, { ref: SHA(4), overwriteEdited: true });
      expect(done.body).toBe("third body");
      const bodies = await Promise.all(
        (await skills.history(a, id)).revisions.map((r) =>
          skills.revision(a, id, r.id).then((x) => x.body),
        ),
      );
      expect(bodies).toContain("my own changes");
      // It is theirs to edit again, and it is no longer marked edited right after an update.
      const [row] = await db.select({ st: skill.sourceState }).from(skill).where(eq(skill.id, id));
      expect(row!.st).toBe("pristine");
    });

    test("only the owner updates; a skill written here has nothing to update from", async () => {
      expect(await fails(updateFromSource(fresh(), b, id, { ref: SHA(4) }))).toMatchObject({
        code: "NOT_FOUND",
      });
      const plain = await make("written-here");
      expect(await fails(updateFromSource(fresh(), a, plain.id, { ref: SHA(4) }))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await checkUpdates(fresh(), a)).some((u) => u.id === plain.id)).toBe(false);
    });

    test("a repository that is gone, and one GitHub will not answer for", async () => {
      upstream.exists = false;
      expect((await checkUpdates(fresh(), a)).find((u) => u.id === id)!.state).toBe("gone");
      upstream.exists = true;
      upstream.status = 429;
      expect((await checkUpdates(fresh(), a)).find((u) => u.id === id)!.state).toBe("unknown");
      upstream.status = 200;
    });

    test("the routes: the check is the caller's own; updating needs a commit, and an edited skill is a 409", async () => {
      expect((await http(A, "GET", "/api/skills/updates")).status).toBe(200);
      expect((await http(A, "POST", `/api/skills/${id}/update`, { ref: "main" })).status).toBe(400);
      expect((await http(B, "POST", `/api/skills/${id}/update`, { ref: SHA(5) })).status).toBe(404);
      const mine = await skills.get(a, id);
      await skills.update(a, id, mine.version, { body: "edited again" });
      const r = await http(A, "POST", `/api/skills/${id}/update`, { ref: SHA(4) });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("EDITED");
    });
  });

  describe("the API", () => {
    test("filters are query parameters; a parameter it does not know is a 400", async () => {
      const r = await http(A, "GET", "/api/skills?q=bulk&sort=name&source=manual");
      expect(r.status).toBe(200);
      const listed: string[] = r.json.skills.map((s: any) => s.name);
      expect(listed).toEqual(listed.toSorted());
      expect(r.json.skills[0]).toHaveProperty("bodyBytes");
      expect((await http(A, "GET", "/api/skills?sort=weird")).status).toBe(400);
      expect((await http(A, "GET", "/api/skills?nope=1")).status).toBe(400);
      expect((await http(A, "GET", `/api/skills?bot=${bot1}`)).json.skills.length).toBeGreaterThan(
        0,
      );
      expect((await http(A, "GET", "/api/skills?scope=all")).status).toBe(403);
    });
    test("restore, bulk and the bot overview are the owner's", async () => {
      const s = await make("api-skill");
      await http(A, "DELETE", `/api/skills/${s.id}`);
      expect((await http(B, "POST", `/api/skills/${s.id}/restore`)).status).toBe(404);
      expect((await http(A, "POST", `/api/skills/${s.id}/restore`)).json.skill.name).toBe(
        "api-skill",
      );
      const bulk = await http(A, "POST", "/api/skills/bulk", {
        action: "attach",
        skillIds: [s.id],
        botIds: [bot1],
      });
      expect(bulk).toMatchObject({ status: 200, json: { changed: 1, skippedBots: [] } });
      expect(
        (
          await http(B, "POST", "/api/skills/bulk", {
            action: "attach",
            skillIds: [s.id],
            botIds: [bot1],
          })
        ).status,
      ).toBe(404);
      expect(
        (await http(A, "POST", "/api/skills/bulk", { action: "explode", skillIds: [s.id] })).status,
      ).toBe(400);
      expect(
        (await http(A, "POST", "/api/skills/bulk", { action: "archive", skillIds: [] })).status,
      ).toBe(400);
      const ov = await http(A, "GET", `/api/bots/${bot1}/skills/overview`);
      expect(ov.status).toBe(200);
      expect(
        ov.json.overview.skills.some((x: any) => x.name === "api-skill" && x.source === "library"),
      ).toBe(true);
      expect((await http(B, "GET", `/api/bots/${bot1}/skills/overview`)).status).toBe(404);
    });
  });
});
