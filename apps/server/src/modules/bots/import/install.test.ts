import { describe, expect, test } from "bun:test";
import { RoutineError, type RoutineInput } from "../../features/routines";
import { MemoryError } from "../../memory/service";
import { SkillError } from "../../skills/service";
import type { BotInput } from "../../chat/service";
import type { SkillFields } from "../../skills/service";
import { draftFixture } from "./fixtures";
import { createInstaller, type InstallDeps } from "./install";

const actor = { userId: "user-1" } as never;
const NOW = new Date("2026-11-09T12:00:00.000Z");

/** In-memory stand-ins for the services, with an ordered log of what was done and a way to make any step fail. */
function world(
  opts: {
    fail?: Record<string, Error>;
    existing?: string[];
    chief?: { harness: string; model: string | null } | null;
  } = {},
) {
  const log: string[] = [];
  const botInputs: BotInput[] = [];
  const skillFields: SkillFields[] = [];
  const attached: [string, string[]][] = [];
  const remembered: {
    owner: string;
    v: { content: string; botId: string; target: string };
    author: unknown;
  }[] = [];
  const routineInputs: RoutineInput[] = [];
  let n = 0;
  const step = (name: string) => {
    log.push(name);
    const e = opts.fail?.[name];
    if (e) throw e;
  };
  const deps: InstallDeps = {
    bots: {
      createBot: async (_a, input) => {
        step("bot.create");
        botInputs.push(input);
        return { id: "bot-1", name: input.name, slug: "example-bot" };
      },
      archiveBot: async (_a, id) => void step(`bot.archive:${id}`),
    },
    skills: {
      create: async (_a, fields) => {
        step(`skill.create:${fields.name}`);
        skillFields.push(fields);
        return { id: `skill-${++n}`, name: fields.name };
      },
      addBots: async (_a, id, botIds) => {
        step(`skill.attach:${id}`);
        attached.push([id, botIds]);
      },
      archive: async (_a, id) => void step(`skill.archive:${id}`),
    },
    memory: {
      remember: async (owner, v, author) => {
        step(`note:${v.content.slice(0, 12)}`);
        remembered.push({ owner, v, author });
        return { page: { slug: `memory-${remembered.length}` }, created: true };
      },
      setStatus: async (_o, slug, status) => void step(`note.${status}:${slug}`),
    },
    routines: {
      create: async (_a, v) => {
        step(`routine.create:${v.title}`);
        routineInputs.push(v);
        return { id: `routine-${++n}` };
      },
      setPaused: async (_a, id, paused) =>
        void step(`routine.${paused ? "pause" : "resume"}:${id}`),
      remove: async (_a, id) => void step(`routine.remove:${id}`),
    },
    skillNames: async () => new Set(opts.existing ?? []),
    chief: async () =>
      opts.chief === undefined ? { harness: "claude-code", model: "model-x" } : opts.chief,
    now: () => NOW,
  };
  return { deps, log, botInputs, skillFields, attached, remembered, routineInputs };
}
const install = (w: ReturnType<typeof world>, draft = draftFixture()) =>
  createInstaller(w.deps).install(actor, draft);

describe("install: what is created", () => {
  test("a bot, its skills, notes and routines, in that order", async () => {
    const w = world();
    await install(w);
    expect(w.log).toEqual([
      "bot.create",
      "skill.create:check-the-list",
      "skill.attach:skill-1",
      "skill.create:weekly-summary",
      "skill.attach:skill-2",
      "note:The list liv",
      "note:Stay quiet w",
      "routine.create:morning-check",
      "routine.resume:routine-3",
      "routine.create:weekly-summary",
      "routine.resume:routine-4",
    ]);
  });

  test("the bot is private, has no code access, and uses the person's Chief engine", async () => {
    const w = world();
    await install(w);
    expect(w.botInputs[0]).toMatchObject({
      name: "Example Bot",
      description: "Checks a list of things every morning and says what changed.",
      personality: "Brief and calm.",
      instructions: "Check the list, say what changed, stay quiet when nothing did.",
      avatar: { kind: "preset", preset: "circle" },
      visibility: "private",
      codeAccess: false,
      harness: "claude-code",
      model: "model-x",
    });
  });

  test("without a real Chief engine the bot keeps the default engine", async () => {
    for (const chief of [
      null,
      { harness: "fixture", model: null },
      { harness: "decision", model: null },
    ]) {
      const w = world({ chief });
      await install(w);
      expect(w.botInputs[0]).not.toHaveProperty("harness");
      expect(w.botInputs[0]).not.toHaveProperty("model");
    }
  });

  test("the bot remembers where it came from, and the integrations it needs", async () => {
    const w = world();
    await install(w);
    expect(w.botInputs[0]!.origin).toEqual({
      source: "grok_marketplace",
      url: "https://x.ai/bot/marketplace/bots/example-bot",
      slug: "example-bot",
      creator: "Example Creator",
      handle: "example",
      importedAt: "2026-11-09T12:00:00.000Z",
      integrations: [
        { name: "Google Calendar", description: "Reads events.", pluginId: "google" },
        { name: "Ramp", description: "Reads card spend.", pluginId: null },
      ],
    });
  });

  test("each skill is created from the draft's text and given to the new bot only", async () => {
    const w = world();
    await install(w);
    expect(w.skillFields.map((f) => f.name)).toEqual(["check-the-list", "weekly-summary"]);
    expect(w.skillFields[0]).toMatchObject({
      description: "Use this when asked to check the list.",
      body: expect.stringContaining("Open the shared sheet"),
    });
    expect(w.attached).toEqual([
      ["skill-1", ["bot-1"]],
      ["skill-2", ["bot-1"]],
    ]);
  });

  test("notes are the new bot's own notes, written as the person", async () => {
    const w = world();
    await install(w);
    expect(w.remembered.map((r) => r.v)).toEqual([
      {
        content: "The list lives in the shared sheet called Things.",
        botId: "bot-1",
        target: "notes",
      },
      { content: "Stay quiet when nothing changed.", botId: "bot-1", target: "notes" },
    ]);
    for (const r of w.remembered) {
      expect(r.owner).toBe("user-1");
      expect(r.author).toEqual({ by: "user" });
    }
  });

  test("routines get their schedule, days, timezone and prompt", async () => {
    const w = world();
    await install(w);
    expect(w.routineInputs[0]).toEqual({
      botId: "bot-1",
      title: "morning-check",
      prompt: "Run the check-the-list skill and report only what changed.",
      timezone: "America/Sao_Paulo",
      dailyAt: "08:44",
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(w.routineInputs[1]).toMatchObject({ dailyAt: "08:49", weekdays: [1] });
  });

  test("an interval routine gets everyMinutes and no time", async () => {
    const w = world();
    await install(
      w,
      draftFixture({
        routines: [
          { ...draftFixture().routines[0]!, schedule: { kind: "interval", everyMinutes: 15 } },
        ],
      }),
    );
    expect(w.routineInputs[0]).toMatchObject({ everyMinutes: 15 });
    expect(w.routineInputs[0]).not.toHaveProperty("dailyAt");
    expect(w.routineInputs[0]).not.toHaveProperty("weekdays");
  });

  test("every-day routines send no weekdays", async () => {
    const w = world();
    await install(
      w,
      draftFixture({
        routines: [
          {
            ...draftFixture().routines[0]!,
            schedule: { kind: "daily", dailyAt: "09:00", weekdays: null },
          },
        ],
      }),
    );
    expect(w.routineInputs[0]).not.toHaveProperty("weekdays");
  });
});

describe("install: the result", () => {
  test("names what was made, and which routines run", async () => {
    const result = await install(world());
    expect(result.bot).toEqual({ id: "bot-1", name: "Example Bot", slug: "example-bot" });
    expect(result.skills.map((s) => s.name)).toEqual(["check-the-list", "weekly-summary"]);
    expect(result.notes).toBe(2);
    expect(result.routines.map((r) => [r.title, r.state, r.reason])).toEqual([
      ["morning-check", "active", null],
      ["weekly-summary", "active", null],
    ]);
    expect(result.integrations).toEqual(draftFixture().integrations);
  });

  test("passes the draft's warnings on", async () => {
    const result = await install(world(), draftFixture({ warnings: ["Read the skills."] }));
    expect(result.warnings).toContain("Read the skills.");
  });
});

describe("install: routines that do not start", () => {
  const withRoutine = (over: Record<string, unknown>) =>
    draftFixture({ routines: [{ ...draftFixture().routines[0]!, ...over } as never] });

  test("one the person left paused is created and left paused", async () => {
    const w = world();
    const result = await install(w, withRoutine({ state: "paused" }));
    expect(w.log).toContain("routine.create:morning-check");
    expect(w.log.some((l) => l.startsWith("routine.resume"))).toBe(false);
    expect(result.routines[0]).toMatchObject({ state: "paused" });
  });

  test("one whose schedule Zetta cannot run is created paused on a placeholder time, with the reason", async () => {
    const w = world();
    const note = 'The schedule "0 9 1 * *" can\'t run in Zetta yet. Pick a time to switch it on.';
    const result = await install(
      w,
      withRoutine({
        schedule: { kind: "unsupported", expression: "0 9 1 * *" },
        state: "paused",
        note,
      }),
    );
    expect(w.routineInputs[0]).toMatchObject({ dailyAt: "09:00" });
    expect(w.log.some((l) => l.startsWith("routine.resume"))).toBe(false);
    expect(result.routines[0]).toMatchObject({ state: "paused", reason: note });
  });

  test("one that is not ready (the bot needs setup) stays paused and says why; the install still succeeds", async () => {
    const w = world({ fail: {} });
    w.deps.routines.setPaused = async (_a, _id, paused) => {
      if (!paused) throw new RoutineError("NOT_READY", ["Connect Google"]);
    };
    const result = await install(w);
    expect(result.routines.every((r) => r.state === "paused")).toBe(true);
    expect(result.routines[0]!.reason).toContain("Connect Google");
    expect(w.log.some((l) => l.startsWith("bot.archive"))).toBe(false);
  });
});

describe("install: checked before anything is created", () => {
  const nothingCreated = (w: ReturnType<typeof world>) => expect(w.log).toEqual([]);

  test("a draft that does not fit the schema", async () => {
    const w = world();
    await expect(install(w, { ...draftFixture(), name: "" })).rejects.toMatchObject({
      code: "INVALID_DRAFT",
    });
    nothingCreated(w);
  });

  test("a draft with an unknown field", async () => {
    const w = world();
    await expect(
      createInstaller(w.deps).install(actor, { ...draftFixture(), ownerUserId: "x" } as never),
    ).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    nothingCreated(w);
  });

  test("a timezone that does not exist", async () => {
    const w = world();
    await expect(install(w, draftFixture({ timezone: "Mars/Olympus_Mons" }))).rejects.toMatchObject(
      { code: "INVALID_DRAFT" },
    );
    nothingCreated(w);
  });

  test("a skill name the person already uses", async () => {
    const w = world({ existing: ["weekly-summary"] });
    await expect(install(w)).rejects.toMatchObject({ code: "DUPLICATE" });
    nothingCreated(w);
  });

  test("two skills with the same name in the draft", async () => {
    const w = world();
    const same = { ...draftFixture().skills[0]! };
    await expect(
      install(w, draftFixture({ skills: [same, { ...same, sourceId: "other" }] })),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    nothingCreated(w);
  });

  test("more skills than the person's library has room for", async () => {
    const w = world({ existing: Array.from({ length: 199 }, (_, i) => `old-${i}`) });
    await expect(install(w)).rejects.toMatchObject({ code: "FULL" });
    nothingCreated(w);
  });

  test("exactly enough room is fine", async () => {
    const w = world({ existing: Array.from({ length: 198 }, (_, i) => `old-${i}`) });
    await expect(install(w)).resolves.toBeDefined();
  });
});

describe("install: when something fails halfway, everything made is undone, newest first", () => {
  test("the second skill is refused: the first skill and the bot are archived", async () => {
    const w = world({ fail: { "skill.create:weekly-summary": new SkillError("DUPLICATE") } });
    await expect(install(w)).rejects.toMatchObject({ code: "DUPLICATE" });
    expect(w.log.slice(w.log.indexOf("skill.create:weekly-summary") + 1)).toEqual([
      "skill.archive:skill-1",
      "bot.archive:bot-1",
    ]);
  });

  test("a skill that cannot be attached is archived with the others", async () => {
    const w = world({ fail: { "skill.attach:skill-2": new SkillError("FULL") } });
    await expect(install(w)).rejects.toMatchObject({ code: "FULL" });
    const undo = w.log.slice(w.log.indexOf("skill.attach:skill-2") + 1);
    expect(undo).toEqual(["skill.archive:skill-2", "skill.archive:skill-1", "bot.archive:bot-1"]);
  });

  test("a note is refused: skills, then the bot, are undone", async () => {
    const w = world({ fail: { "note:Stay quiet w": new MemoryError("INVALID" as never) } });
    await expect(install(w)).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    const undo = w.log.slice(w.log.indexOf("note:Stay quiet w") + 1);
    expect(undo).toEqual([
      "note.archived:memory-1",
      "skill.archive:skill-2",
      "skill.archive:skill-1",
      "bot.archive:bot-1",
    ]);
  });

  test("a routine cannot be created: routines, notes, skills and the bot are all undone", async () => {
    const w = world({ fail: { "routine.create:weekly-summary": new RoutineError("INVALID") } });
    await expect(install(w)).rejects.toBeDefined();
    const undo = w.log.slice(w.log.indexOf("routine.create:weekly-summary") + 1);
    expect(undo[0]).toMatch(/^routine\.remove:/);
    expect(undo).toContain("note.archived:memory-2");
    expect(undo).toContain("note.archived:memory-1");
    expect(undo.slice(-3)).toEqual([
      "skill.archive:skill-2",
      "skill.archive:skill-1",
      "bot.archive:bot-1",
    ]);
  });

  test("the bot itself cannot be created: nothing else was made, nothing to undo", async () => {
    const w = world({ fail: { "bot.create": new Error("bot name taken") } });
    await expect(install(w)).rejects.toThrow("bot name taken");
    expect(w.log).toEqual(["bot.create"]);
  });

  test("an error while undoing does not hide the first error, and the rest is still undone", async () => {
    const w = world({
      fail: {
        "skill.create:weekly-summary": new SkillError("FULL"),
        "skill.archive:skill-1": new Error("db hiccup"),
      },
    });
    await expect(install(w)).rejects.toMatchObject({ code: "FULL" });
    expect(w.log).toContain("bot.archive:bot-1");
  });
});

describe("install: errors are turned into something a person can read", () => {
  const failWith = async (error: Error) => {
    const w = world({ fail: { "skill.create:check-the-list": error } });
    return install(w).then(
      () => {
        throw new Error("the install should have failed");
      },
      (e: unknown) => e as { code?: string; message: string },
    );
  };

  test("a full library is FULL", async () => {
    expect(await failWith(new SkillError("FULL"))).toMatchObject({ code: "FULL" });
  });

  test("a name in use is DUPLICATE", async () => {
    expect(await failWith(new SkillError("DUPLICATE"))).toMatchObject({ code: "DUPLICATE" });
  });

  test("a skill the library refuses as secret names the skill", async () => {
    const e = await failWith(new SkillError("SECRET_REJECTED"));
    expect(e).toMatchObject({ code: "INVALID_DRAFT" });
    expect(e.message).toContain("check-the-list");
  });

  test("an error that is not ours is passed up unchanged", async () => {
    const boom = new Error("unexpected");
    expect(await failWith(boom)).toBe(boom);
  });
});
