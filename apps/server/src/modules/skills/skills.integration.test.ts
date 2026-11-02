import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createBotClaude } from "../bot-claude/store";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { createFeaturesService } from "../features/service";
import { createIdentityAccess } from "../identity/access";
import { createWiki } from "../wiki/service";
import { createMarket } from "./market";
import { createSkills } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`sk-a-${uuidv7()}`, `sk-b-${uuidv7()}`, `sk-admin-${uuidv7()}`, `sk-c-${uuidv7()}`];
const [A, B, ADMIN, C] = ids as [string, string, string, string];

suite("skill library", () => {
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
    async (userId) => ({ isAdmin: userId === ADMIN }),
  );
  const prompts: string[] = [];
  /** What the bot says next, one entry per model call; once it is empty the bot says OK. */
  const script: string[] = [];
  let installed: Record<string, string> = {};
  type Run = { prompt: string; harness: string; profile?: { files: Record<string, string> } };
  const cli = async (t: Run) => {
    prompts.push(t.prompt);
    installed = t.profile?.files ?? {};
    return script.shift() ?? "OK";
  };
  const stream = async function* (t: Run) {
    prompts.push(t.prompt);
    installed = t.profile?.files ?? {};
    yield script.shift() ?? "OK";
  };
  // GitHub, the one true external boundary: two suggested repositories and one that is not on the list.
  const SHA = "1234567890abcdef1234567890abcdef12345678";
  const SHA2 = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const SHA3 = "0123456789012345678901234567890123456789";
  const repos: Record<string, { sha: string; files: Record<string, string> }> = {
    "acme/skills": {
      sha: SHA,
      files: {
        "skills/pdf/SKILL.md": "---\nname: PDF Tools\ndescription: Make PDFs\n---\nmarket steps",
        "skills/interview-me/SKILL.md":
          "---\ndescription: Interview the user about what they want\n---\nask questions",
        "skills/unsafe/SKILL.md": "---\ndescription: Bad\n---\nRun !`id` now",
      },
    },
    "other/tools": {
      sha: SHA2,
      files: {
        "tools/review/SKILL.md":
          "---\ndescription: Review a pull request carefully\n---\nreview steps",
      },
    },
    "free/stuff": {
      sha: SHA3,
      files: { "stuff/notes/SKILL.md": "---\ndescription: Take notes\n---\nnote steps" },
    },
  };
  const requested: string[] = [];
  const github = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.href);
    const api = /^\/repos\/([^/]+\/[^/]+)\/(commits\/HEAD|git\/trees\/[0-9a-f]{40})$/.exec(
      url.pathname,
    );
    if (url.hostname === "api.github.com" && api) {
      const repo = repos[api[1]!];
      if (!repo) return new Response("not found", { status: 404 });
      if (api[2] === "commits/HEAD") return new Response(repo.sha);
      return Response.json({
        tree: [
          { path: "README.md", type: "blob" },
          ...Object.keys(repo.files).map((path) => ({ path, type: "blob" })),
          { path: "node_modules/x/SKILL.md", type: "blob" },
        ],
      });
    }
    const raw = /^\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url.pathname);
    if (url.hostname === "raw.githubusercontent.com" && raw) {
      const repo = repos[raw[1]!];
      const text =
        repo && repo.sha === raw[2] ? repo.files[decodeURIComponent(raw[3]!)] : undefined;
      if (text !== undefined) return new Response(text);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const suggestions = [
    { repo: "acme/skills", blurb: "Acme's skills.", trust: "trusted" as const },
    { repo: "other/tools", blurb: "Other tools.", trust: "official" as const },
  ];
  const library = createSkills(db);
  const market = createMarket({ fetch: github, suggestions });
  const wiki = createWiki(db);
  const run = createTurnRunner(db, cli as never, stream as never, wiki);
  const features = createFeaturesService(db, run);
  const chat = createChatService(
    db,
    run,
    undefined,
    undefined,
    undefined,
    undefined,
    { routine: features.routines.create as never, workflow: features.workflows.save as never },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { wiki, skills: { skills: library, market } },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    features: { access, features },
    skills: { access, db, skills: library, market },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const makeBot = async (as: string, name: string) => {
    const b = (await call(as, "POST", "/api/bots", { name, harness: "claude-code" })).json.bot;
    await db.$client.query("update bot set onboarded = true where id = $1", [b.id]);
    return b as { id: string };
  };
  const notes = {
    name: "release-notes",
    description: "Write release notes",
    body: "1) list the merged PRs",
  };

  beforeAll(async () => {
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
  });

  test("a skill belongs to its owner: others cannot read or change it, and a name is used once", async () => {
    const made = await call(A, "POST", "/api/skills", notes);
    expect(made.status).toBe(201);
    const id = made.json.skill.id as string;
    expect(made.json.skill).toMatchObject({ ...notes, source: "manual", version: 1, botIds: [] });
    expect((await call(A, "GET", "/api/skills")).json.skills.map((s: any) => s.name)).toEqual([
      "release-notes",
    ]);
    expect((await call(A, "GET", "/api/skills")).json.skills[0].body).toBeUndefined();
    expect((await call(B, "GET", "/api/skills")).json.skills).toEqual([]);
    expect((await call(B, "GET", `/api/skills/${id}`)).status).toBe(404);
    expect(
      (await call(B, "PATCH", `/api/skills/${id}`, { expectedVersion: 1, description: "x" }))
        .status,
    ).toBe(404);
    expect((await call(B, "DELETE", `/api/skills/${id}`)).status).toBe(404);
    expect((await call(A, "POST", "/api/skills", notes)).status).toBe(409);
    expect((await call(B, "POST", "/api/skills", notes)).status).toBe(201);
    // Text that would run shell commands, or holds a secret, is refused.
    expect(
      (await call(A, "POST", "/api/skills", { ...notes, name: "shell", body: "Run !`id` now" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(A, "POST", "/api/skills", {
          ...notes,
          name: "keys",
          body: "use sk-test-0123456789abcdefghij",
        })
      ).status,
    ).toBe(400);
    // Edits are versioned.
    const edited = await call(A, "PATCH", `/api/skills/${id}`, {
      expectedVersion: 1,
      body: "1) list the PRs 2) group them",
    });
    expect(edited.json.skill).toMatchObject({ body: "1) list the PRs 2) group them", version: 2 });
    expect(
      (await call(A, "PATCH", `/api/skills/${id}`, { expectedVersion: 1, body: "stale" })).status,
    ).toBe(409);
  });

  test("an admin sees every person's skills and may archive them, but cannot edit", async () => {
    const mine = (await call(A, "POST", "/api/skills", { ...notes, name: "for-admin" })).json.skill
      .id as string;
    expect((await call(A, "GET", "/api/skills?scope=all")).status).toBe(403);
    const all = (await call(ADMIN, "GET", "/api/skills?scope=all")).json.skills as {
      name: string;
      ownerUserId: string;
    }[];
    expect(all.filter((s) => s.name === "for-admin").map((s) => s.ownerUserId)).toEqual([A]);
    expect((await call(ADMIN, "GET", "/api/skills")).json.skills).toEqual([]);
    expect(
      (await call(ADMIN, "PATCH", `/api/skills/${mine}`, { expectedVersion: 1, description: "x" }))
        .status,
    ).toBe(404);
    expect((await call(ADMIN, "DELETE", `/api/skills/${mine}`)).status).toBe(200);
    expect((await call(A, "GET", `/api/skills/${mine}`)).status).toBe(404);
    // The name is free again.
    expect((await call(A, "POST", "/api/skills", { ...notes, name: "for-admin" })).status).toBe(
      201,
    );
  });

  test("a bot brings the skills attached to it: listed in the picker, installed for Claude Code, own skill wins, archive withdraws it", async () => {
    const mine = (
      await call(A, "POST", "/api/skills", { ...notes, name: "bring-me", body: "library steps" })
    ).json.skill.id as string;
    const bot = await makeBot(A, "Specialist");
    const other = await makeBot(B, "Stranger");
    expect((await call(A, "PUT", `/api/skills/${mine}/bots`, { botIds: [other.id] })).status).toBe(
      404,
    );
    expect((await call(B, "PUT", `/api/skills/${mine}/bots`, { botIds: [other.id] })).status).toBe(
      404,
    );
    expect((await call(A, "PUT", `/api/skills/${mine}/bots`, { botIds: [bot.id] })).json).toEqual({
      botIds: [bot.id],
    });
    expect((await call(A, "GET", `/api/skills/${mine}`)).json.skill.botIds).toEqual([bot.id]);

    const say = async (skills: string[]) => {
      const conv = (await call(A, "POST", "/api/conversations", { botId: bot.id })).json
        .conversation.id;
      prompts.length = 0;
      return call(A, "POST", `/api/conversations/${conv}/messages`, { content: "Go", skills });
    };
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/skills`)).json.skills.find(
        (s: any) => s.name === "bring-me",
      ),
    ).toEqual({ name: "bring-me", description: "Write release notes", source: "bot" });
    expect((await say(["bring-me"])).status).toBe(201);
    expect(prompts.at(-1)).toContain(
      "Load each with the Skill tool before you answer: zetta-bot:bring-me.",
    );
    expect(installed["skills/bring-me/SKILL.md"]).toContain("library steps");

    // An edit in the library reaches the bot at its next run.
    await call(A, "PATCH", `/api/skills/${mine}`, { expectedVersion: 1, body: "edited steps" });
    await say(["bring-me"]);
    expect(installed["skills/bring-me/SKILL.md"]).toContain("edited steps");

    // A skill written for this bot with the same name wins over the library.
    await createBotClaude(db).addAsset(bot.id, {
      kind: "skill",
      name: "bring-me",
      description: "Bot's own",
      body: "own steps",
      tools: [],
      model: null,
      enabled: true,
    });
    await say(["bring-me"]);
    expect(installed["skills/bring-me/SKILL.md"]).toContain("own steps");

    // Archiving withdraws the library skill; with only the library one left, a pick is refused.
    const lone = (await call(A, "POST", "/api/skills", { ...notes, name: "lone-skill" })).json.skill
      .id as string;
    await call(A, "PUT", `/api/skills/${lone}/bots`, { botIds: [bot.id] });
    expect((await say(["lone-skill"])).status).toBe(201);
    await call(ADMIN, "DELETE", `/api/skills/${lone}`);
    expect((await say(["lone-skill"])).status).toBe(404);
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/skills`)).json.skills.map((s: any) => s.name),
    ).not.toContain("lone-skill");
  });

  test("search covers the suggested repositories, and a repository can be browsed and installed from by choosing skills", async () => {
    const sugg = (await call(A, "GET", "/api/skills/market/suggestions")).json.suggestions as {
      repo: string;
    }[];
    expect(sugg.map((x) => x.repo)).toEqual(["acme/skills", "other/tools"]);

    const hit = (q: string) =>
      call(A, "GET", `/api/skills/market/search?q=${encodeURIComponent(q)}`);
    const interview = {
      repo: "acme/skills",
      ref: SHA,
      trust: "trusted",
      name: "interview-me",
      path: "skills/interview-me/SKILL.md",
      description: "Interview the user about what they want",
      warnings: [],
      installedId: null,
    };
    expect((await hit("interview-me")).json).toEqual({
      skills: [interview],
      unavailable: [],
      indexing: false,
    });
    expect((await hit("interview")).json.skills).toEqual([interview]);
    expect(
      (await hit("pull request")).json.skills.map((k: any) => [k.repo, k.name, k.trust]),
    ).toEqual([["other/tools", "review", "official"]]);
    expect((await hit("pdf")).json.skills.map((k: any) => k.name)).toEqual(["pdf"]);
    expect((await hit("unsafe")).json.skills[0].warnings).toEqual(["shell_injection"]);
    expect((await hit("zzzz")).json.skills).toEqual([]);
    expect((await hit("a")).status).toBe(400);
    // Skills of a repository that is not on the list are not searched.
    expect((await hit("notes")).json.skills).toEqual([]);

    const repo = (
      await call(A, "GET", "/api/skills/market/repo?source=https://github.com/acme/skills")
    ).json;
    expect(repo).toMatchObject({
      repo: "acme/skills",
      ref: SHA,
      trust: "trusted",
      truncated: false,
    });
    expect(repo.skills.map((k: any) => [k.name, k.description, k.warnings, k.installedId])).toEqual(
      [
        ["pdf", "Make PDFs", [], null],
        ["interview-me", "Interview the user about what they want", [], null],
        ["unsafe", "Bad", ["shell_injection"], null],
      ],
    );
    // A repository that is not on the list can still be opened, and is marked as not trusted.
    expect(
      (await call(A, "GET", "/api/skills/market/repo?source=free/stuff")).json.trust,
    ).toBeNull();

    const bot = await makeBot(A, "Reader");
    const body = {
      source: "acme/skills",
      sha: SHA,
      paths: ["skills/pdf/SKILL.md", "skills/interview-me/SKILL.md", "skills/unsafe/SKILL.md"],
      botIds: [bot.id],
    };
    const done = await call(A, "POST", "/api/skills/market/install", body);
    expect(done.status).toBe(201);
    expect(done.json.attachError).toBeNull();
    expect(done.json.failed).toEqual([{ path: "skills/unsafe/SKILL.md", code: "UNINSTALLABLE" }]);
    expect(
      done.json.installed.map((s: any) => [s.name, s.source, s.sourceRepo, s.sourceRef, s.botIds]),
    ).toEqual([
      ["pdf", "github", "acme/skills", SHA, [bot.id]],
      ["interview-me", "github", "acme/skills", SHA, [bot.id]],
    ]);
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/skills`)).json.skills.map((s: any) => s.name),
    ).toEqual(expect.arrayContaining(["pdf", "interview-me"]));

    // Installed ones are marked in search and in the repository, and installing again changes nothing.
    expect((await hit("interview")).json.skills[0].installedId).toBe(done.json.installed[1].id);
    expect(
      (await call(B, "GET", "/api/skills/market/search?q=interview")).json.skills[0].installedId,
    ).toBeNull();
    const again = await call(A, "POST", "/api/skills/market/install", { ...body, botIds: [] });
    expect(again.json.installed).toEqual([]);
    expect(again.json.failed.map((f: any) => f.code)).toEqual([
      "INSTALLED",
      "INSTALLED",
      "UNINSTALLABLE",
    ]);
    // An installed skill can still be chosen, to bring it to another bot: it is added next to the bots that already have it.
    const second = await makeBot(A, "Second");
    const more = await call(A, "POST", "/api/skills/market/install", {
      ...body,
      botIds: [second.id],
    });
    expect(more.json.installed).toEqual([]);
    expect(more.json.failed.map((f: any) => f.code)).toEqual(["UNINSTALLABLE"]);
    expect(more.json.attached.map((s: any) => [s.name, [...s.botIds].sort()])).toEqual([
      ["pdf", [bot.id, second.id].sort()],
      ["interview-me", [bot.id, second.id].sort()],
    ]);
    expect(
      (await call(A, "GET", `/api/bots/${bot.id}/skills`)).json.skills.map((s: any) => s.name),
    ).toEqual(expect.arrayContaining(["pdf", "interview-me"]));
    expect(
      (await call(A, "GET", `/api/bots/${second.id}/skills`)).json.skills.map((s: any) => s.name),
    ).toEqual(expect.arrayContaining(["pdf", "interview-me"]));

    // A commit that does not exist installs nothing; an address that is not GitHub is refused; only GitHub is contacted.
    const wrong = await call(B, "POST", "/api/skills/market/install", {
      ...body,
      botIds: [],
      sha: "f".repeat(40),
      paths: ["skills/pdf/SKILL.md"],
    });
    expect(wrong.json).toMatchObject({
      installed: [],
      failed: [{ path: "skills/pdf/SKILL.md", code: "NOT_FOUND" }],
    });
    expect(
      (
        await call(A, "POST", "/api/skills/market/install", {
          ...body,
          source: "https://evil.example/acme/skills",
        })
      ).status,
    ).toBe(400);
    expect(new Set(requested.map((u) => new URL(u).hostname))).toEqual(
      new Set(["api.github.com", "raw.githubusercontent.com"]),
    );
  });

  const ask = (source: string, names: string[] = []) =>
    "I can add those.\n```zetta:skills\n" +
    JSON.stringify({ action: "install", source, ...(names.length ? { names } : {}) }) +
    "\n```";
  const talk = async (as: string, botId: string, content: string) => {
    const conv = (await call(as, "POST", "/api/conversations", { botId })).json.conversation.id;
    return call(as, "POST", `/api/conversations/${conv}/messages`, { content });
  };
  const pending = async (as: string) =>
    (await call(as, "GET", "/api/proposals")).json.proposals as {
      id: string;
      kind: string;
      botId: string;
      patch: any;
    }[];
  const decide = (as: string, id: string, body: unknown) =>
    call(as, "POST", `/api/proposals/${id}/decision`, body);
  const namesOf = async (as: string, botId: string) =>
    (await call(as, "GET", `/api/bots/${botId}/skills`)).json.skills.map((k: any) => k.name);

  test("a bot that asks to install skills only shows a card; nothing is installed until the person chooses, and only what they choose", async () => {
    const bot = await makeBot(C, "Asker");
    const spare = await makeBot(C, "Spare");
    script.push(ask("acme/skills", ["interview-me"]));
    const sent = await talk(
      C,
      bot.id,
      "Please add the interview skill from https://github.com/acme/skills",
    );
    expect(sent.status).toBe(201);

    // The turn is in apply mode, yet the proposal is not applied: it waits for the person.
    const [card] = (await pending(C)).filter((p) => p.kind === "install_skills");
    expect(card).toMatchObject({ botId: bot.id });
    expect(card!.patch).toMatchObject({
      repo: "acme/skills",
      ref: SHA,
      trust: "trusted",
      preselected: ["skills/interview-me/SKILL.md"],
    });
    expect(card!.patch.skills.map((k: any) => [k.name, k.installed, k.warnings])).toEqual([
      ["pdf", false, []],
      ["interview-me", false, []],
      ["unsafe", false, ["shell_injection"]],
    ]);
    expect(
      (await call(C, "GET", "/api/skills")).json.skills.map((k: any) => k.sourceRepo),
    ).not.toContain("acme/skills");
    // The bot was told it is waiting, not that it is done.
    expect(prompts.at(-1)).toContain("They are NOT installed");

    // No choice, or a skill that was not offered, is refused and the card stays.
    expect((await decide(C, card!.id, { approve: true })).status).toBe(400);
    expect(
      (
        await decide(C, card!.id, {
          approve: true,
          selection: { paths: ["skills/other/SKILL.md"], target: "bot" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await decide(C, card!.id, { approve: true, selection: { paths: [], target: "bot" } }))
        .status,
    ).toBe(400);
    // Another person cannot decide it.
    expect((await decide(B, card!.id, { approve: false })).status).toBe(404);
    expect((await pending(C)).some((p) => p.id === card!.id)).toBe(true);

    // The person chooses one skill for this bot: only that one is installed, only this bot gets it.
    const done = await decide(C, card!.id, {
      approve: true,
      selection: { paths: ["skills/pdf/SKILL.md"], target: "bot" },
    });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({
      status: "approved",
      skills: { installed: ["pdf"], failed: [], attachError: null, bots: 1, skippedBots: 0 },
    });
    expect(await namesOf(C, bot.id)).toContain("pdf");
    expect(await namesOf(C, bot.id)).not.toContain("interview-me");
    expect(await namesOf(C, spare.id)).not.toContain("pdf");
    expect((await pending(C)).some((p) => p.id === card!.id)).toBe(false);

    // The same repository again: pdf is already in the library, and it can still be chosen to give it to all bots.
    script.push(ask("acme/skills", ["pdf"]));
    await talk(C, bot.id, "Add the pdf skill to all my bots");
    const [again] = (await pending(C)).filter((p) => p.kind === "install_skills");
    expect(again!.patch.skills.find((k: any) => k.name === "pdf").installed).toBe(true);
    const all = await decide(C, again!.id, {
      approve: true,
      selection: { paths: ["skills/pdf/SKILL.md"], target: "all" },
    });
    expect(all.json.skills).toMatchObject({ installed: [], attached: ["pdf"], failed: [] });
    expect(await namesOf(C, spare.id)).toContain("pdf");
    expect(await namesOf(C, bot.id)).toContain("pdf");
  });

  test("the person can give the skills to all their bots, say not now, and a bot on another harness cannot ask", async () => {
    const one = await makeBot(C, "Alpha");
    const two = await makeBot(C, "Beta");
    const theirs = await makeBot(B, "Theirs");
    script.push(ask("other/tools"));
    await talk(C, one.id, "Add the review skills from other/tools");
    const [card] = (await pending(C)).filter(
      (p) => p.kind === "install_skills" && p.patch.repo === "other/tools",
    );
    expect(card!.patch).toMatchObject({ trust: "official", preselected: [] });
    const all = await decide(C, card!.id, {
      approve: true,
      selection: { paths: ["tools/review/SKILL.md"], target: "all" },
    });
    expect(all.json.skills.installed).toEqual(["review"]);
    expect(await namesOf(C, one.id)).toContain("review");
    expect(await namesOf(C, two.id)).toContain("review");
    // Only the person's own bots: another person's bot gets nothing.
    expect(await namesOf(B, theirs.id)).not.toContain("review");

    // Not now: nothing is installed, and the repository is marked as not trusted.
    script.push(ask("free/stuff"));
    await talk(C, one.id, "Add the notes skill from free/stuff");
    const [off] = (await pending(C)).filter(
      (p) => p.kind === "install_skills" && p.patch.repo === "free/stuff",
    );
    expect(off!.patch.trust).toBeNull();
    expect((await decide(C, off!.id, { approve: false })).json).toEqual({ status: "rejected" });
    expect((await call(C, "GET", "/api/skills")).json.skills.map((k: any) => k.name)).not.toContain(
      "notes",
    );

    // A bot whose harness does not load library skills is not offered the tool and cannot raise the card.
    const plain = (await call(C, "POST", "/api/bots", { name: "Plain", harness: "pi" })).json
      .bot as { id: string };
    await db.$client.query("update bot set onboarded = true where id = $1", [plain.id]);
    const before = (await pending(C)).length;
    script.push(ask("acme/skills"));
    await talk(C, plain.id, "Add the skills from acme/skills");
    expect((await pending(C)).length).toBe(before);
    expect(prompts.at(-1)).not.toContain("zetta:skills");
  });
});
