import { describe, expect, test } from "bun:test";
import { botImportDraftSchema } from "./draft";
import { draftFixture } from "./fixtures";

const ok = (d: unknown) => botImportDraftSchema.safeParse(d);
const messages = (d: unknown) => {
  const r = ok(d);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("botImportDraftSchema", () => {
  test("accepts the draft analyze produces", () => {
    expect(ok(draftFixture()).success).toBe(true);
  });

  test("a draft with nothing optional filled in is fine", () => {
    expect(
      ok(
        draftFixture({
          skills: [],
          notes: [],
          routines: [],
          integrations: [],
          warnings: [],
          personality: "",
          instructions: "",
        }),
      ).success,
    ).toBe(true);
  });

  test("an unknown field is refused (the client cannot slip one in)", () => {
    expect(ok({ ...draftFixture(), origin: { source: "grok_marketplace" } }).success).toBe(false);
    expect(ok({ ...draftFixture(), ownerUserId: "someone-else" }).success).toBe(false);
  });

  describe("source", () => {
    test("must be the bot's page on x.ai", () => {
      const bad = draftFixture({
        source: {
          url: "https://evil.example.invalid/bot/marketplace/bots/example-bot",
          slug: "example-bot",
          creator: "c",
          handle: null,
        },
      });
      expect(messages(bad).join()).toContain("source.url");
    });

    test("the slug must match the URL", () => {
      const bad = draftFixture({
        source: {
          url: "https://x.ai/bot/marketplace/bots/example-bot",
          slug: "another",
          creator: "c",
          handle: null,
        },
      });
      expect(ok(bad).success).toBe(false);
    });
  });

  describe("name and text limits", () => {
    test("an empty or blank name is refused", () => {
      expect(ok(draftFixture({ name: "" })).success).toBe(false);
      expect(ok(draftFixture({ name: "   " })).success).toBe(false);
    });

    test("the name, description, personality and instructions have the bot's limits", () => {
      expect(ok(draftFixture({ name: "x".repeat(80) })).success).toBe(true);
      expect(ok(draftFixture({ name: "x".repeat(81) })).success).toBe(false);
      expect(ok(draftFixture({ description: "x".repeat(2049) })).success).toBe(false);
      expect(ok(draftFixture({ personality: "x".repeat(4097) })).success).toBe(false);
      expect(ok(draftFixture({ instructions: "x".repeat(16_385) })).success).toBe(false);
    });
  });

  describe("avatar", () => {
    test("a preset or a small image data URL is fine", () => {
      expect(
        ok(draftFixture({ avatar: { kind: "preset", preset: "drop", colors: ["#d4504c"] } }))
          .success,
      ).toBe(true);
      expect(
        ok(draftFixture({ avatar: { kind: "image", src: "data:image/png;base64,AAAA" } })).success,
      ).toBe(true);
    });

    test("a remote image link or an SVG is refused", () => {
      expect(
        ok({ ...draftFixture(), avatar: { kind: "image", src: "https://example.invalid/a.png" } })
          .success,
      ).toBe(false);
      expect(
        ok({ ...draftFixture(), avatar: { kind: "image", src: "data:image/svg+xml;base64,AAAA" } })
          .success,
      ).toBe(false);
    });

    test("a bad color is refused", () => {
      expect(
        ok({ ...draftFixture(), avatar: { kind: "preset", preset: "circle", colors: ["red"] } })
          .success,
      ).toBe(false);
    });
  });

  describe("skills", () => {
    const skill = (over: Record<string, unknown>) => ({ ...draftFixture().skills[0]!, ...over });

    test("the name follows the skill-name rule", () => {
      expect(
        ok(draftFixture({ skills: [skill({ name: "Check The List" }) as never] })).success,
      ).toBe(false);
      expect(ok(draftFixture({ skills: [skill({ name: "1check" }) as never] })).success).toBe(
        false,
      );
      expect(ok(draftFixture({ skills: [skill({ name: "check-list-2" }) as never] })).success).toBe(
        true,
      );
    });

    test("an empty body is refused", () => {
      expect(ok(draftFixture({ skills: [skill({ body: "  " }) as never] })).success).toBe(false);
    });

    test("a body that runs shell commands is refused", () => {
      expect(
        ok(draftFixture({ skills: [skill({ body: "Run !`rm -rf /` now" }) as never] })).success,
      ).toBe(false);
    });

    test("a body over the library limit is refused", () => {
      expect(
        ok(draftFixture({ skills: [skill({ body: "x".repeat(64_001) }) as never] })).success,
      ).toBe(false);
      expect(
        ok(draftFixture({ skills: [skill({ body: "x".repeat(64_000) }) as never] })).success,
      ).toBe(true);
    });

    test("more skills than one bot can hold is refused", () => {
      const many = Array.from(
        { length: 26 },
        (_, i) => skill({ name: `skill-${i}`, sourceId: `s${i}` }) as never,
      );
      expect(ok(draftFixture({ skills: many })).success).toBe(false);
      expect(ok(draftFixture({ skills: many.slice(0, 25) })).success).toBe(true);
    });
  });

  describe("notes", () => {
    test("an empty note is refused, a long one is cut off at the limit", () => {
      expect(
        ok(draftFixture({ notes: [{ sourceId: "m", content: " ", warnings: [] }] })).success,
      ).toBe(false);
      expect(
        ok(draftFixture({ notes: [{ sourceId: "m", content: "x".repeat(20_000), warnings: [] }] }))
          .success,
      ).toBe(true);
      expect(
        ok(draftFixture({ notes: [{ sourceId: "m", content: "x".repeat(20_001), warnings: [] }] }))
          .success,
      ).toBe(false);
    });
  });

  describe("routines", () => {
    const routine = (over: Record<string, unknown>) =>
      ({ ...draftFixture().routines[0]!, ...over }) as never;

    test("a daily routine with weekdays, and an interval routine, are fine", () => {
      expect(ok(draftFixture({ routines: [routine({})] })).success).toBe(true);
      expect(
        ok(
          draftFixture({
            routines: [routine({ schedule: { kind: "interval", everyMinutes: 15 } })],
          }),
        ).success,
      ).toBe(true);
    });

    test("an interval below five minutes or an impossible time is refused", () => {
      expect(
        ok(
          draftFixture({
            routines: [routine({ schedule: { kind: "interval", everyMinutes: 4 } })],
          }),
        ).success,
      ).toBe(false);
      expect(
        ok(
          draftFixture({
            routines: [routine({ schedule: { kind: "daily", dailyAt: "24:00", weekdays: null } })],
          }),
        ).success,
      ).toBe(false);
      expect(
        ok(
          draftFixture({
            routines: [routine({ schedule: { kind: "daily", dailyAt: "9:00", weekdays: null } })],
          }),
        ).success,
      ).toBe(false);
    });

    test("a weekday outside 0-6 is refused", () => {
      expect(
        ok(
          draftFixture({
            routines: [routine({ schedule: { kind: "daily", dailyAt: "09:00", weekdays: [7] } })],
          }),
        ).success,
      ).toBe(false);
    });

    test("a schedule Zetta cannot run stays paused: active is refused", () => {
      const unsupported = { kind: "unsupported", expression: "0 9 1 * *" };
      expect(
        ok(draftFixture({ routines: [routine({ schedule: unsupported, state: "active" })] }))
          .success,
      ).toBe(false);
      expect(
        ok(
          draftFixture({
            routines: [
              routine({
                schedule: unsupported,
                state: "paused",
                note: "Schedule can't run in Zetta yet.",
              }),
            ],
          }),
        ).success,
      ).toBe(true);
    });

    test("the state is one of two words, not a boolean", () => {
      expect(ok(draftFixture({ routines: [routine({ state: true })] })).success).toBe(false);
      expect(ok(draftFixture({ routines: [routine({ state: "running" })] })).success).toBe(false);
    });

    test("the title and prompt have the routine limits", () => {
      expect(ok(draftFixture({ routines: [routine({ title: "x".repeat(121) })] })).success).toBe(
        false,
      );
      expect(ok(draftFixture({ routines: [routine({ prompt: "x".repeat(8001) })] })).success).toBe(
        false,
      );
      expect(ok(draftFixture({ routines: [routine({ prompt: "" })] })).success).toBe(false);
    });
  });

  describe("integrations", () => {
    test("a plugin id must look like one", () => {
      expect(
        ok(
          draftFixture({
            integrations: [{ name: "X", description: "", pluginId: "Not A Plugin" }],
          }),
        ).success,
      ).toBe(false);
      expect(
        ok(
          draftFixture({
            integrations: [{ name: "X", description: "", pluginId: "chrome-devtools" }],
          }),
        ).success,
      ).toBe(true);
      expect(
        ok(draftFixture({ integrations: [{ name: "X", description: "", pluginId: null }] }))
          .success,
      ).toBe(true);
    });
  });
});
