import { describe, expect, test } from "bun:test";
import { ImportError } from "./errors";
import { createGrokSource, parseGrokBots, parseGrokUrl } from "./grok-source";

// Synthetic pages only: invented names, no text copied from the real marketplace. The shape mimics how a Next.js page streams its data:
// `self.__next_f.push([1,"<escaped string>"])` chunks that, put together, hold JSON objects.
const bot = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Example ${id}`,
  creatorName: "Example Creator",
  handle: "example",
  description: `Description of ${id}.`,
  summary: `Summary of ${id}.`,
  categories: ["Research"],
  installCount: 3,
  color: "blue",
  shape: "circle",
  addHref: `/bot/${id}-add`,
  imageUrl: "https://assets.example.invalid/img/creator.png",
  updatedAt: "2026-01-01T00:00:00.000Z",
  instructions: "",
  memories: [{ id: "memory-0", name: "memory 1", description: "A fact the bot knows." }],
  skills: [
    {
      id: "skill-0",
      name: "Do a thing",
      description: "Use this to do a thing.",
      content: "Use this to do a thing.",
    },
  ],
  routines: [
    {
      id: "routine-0",
      name: "daily-check",
      summary: "Cron 0 9 * * * (daily 9:00 local). Checks things.",
    },
  ],
  integrations: [{ id: "integration-0", name: "Calendar", description: "Reads events." }],
  ...over,
});

/** Wraps flight-like text into the HTML a page would carry, cut into several chunks. */
const page = (text: string, chunks = 1) => {
  const size = Math.ceil(text.length / chunks);
  const parts = Array.from({ length: chunks }, (_, i) => text.slice(i * size, (i + 1) * size));
  const scripts = parts.map((p) => `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`);
  return `<!doctype html><html><head><title>x</title></head><body><div>nav</div>${scripts.join("")}</body></html>`;
};
const flight = (...bots: unknown[]) =>
  `1a:["$","div",null,{"bots":${JSON.stringify(bots)},"other":{"id":"not-a-bot"}}]\n`;

describe("parseGrokUrl", () => {
  test.each([
    ["a bare id", "dr-example-v2", "dr-example-v2"],
    ["the page URL", "https://x.ai/bot/marketplace/bots/dr-example-v2", "dr-example-v2"],
    ["with a trailing slash", "https://x.ai/bot/marketplace/bots/dr-example-v2/", "dr-example-v2"],
    [
      "with a query and fragment",
      "https://x.ai/bot/marketplace/bots/dr-example-v2?ref=x#top",
      "dr-example-v2",
    ],
    ["on www", "https://www.x.ai/bot/marketplace/bots/dr-example-v2", "dr-example-v2"],
    ["with spaces around it", "  dr-example-v2  ", "dr-example-v2"],
  ])("accepts %s", (_n, input, slug) => {
    expect(parseGrokUrl(input)).toBe(slug);
  });

  test.each([
    ["another host", "https://evil.example.invalid/bot/marketplace/bots/a"],
    ["a look-alike host", "https://x.ai.evil.example.invalid/bot/marketplace/bots/a"],
    ["user info in front of the host", "https://x.ai@evil.example.invalid/bot/marketplace/bots/a"],
    ["http", "http://x.ai/bot/marketplace/bots/a"],
    ["another path on x.ai", "https://x.ai/bot/marketplace"],
    ["a deeper path", "https://x.ai/bot/marketplace/bots/a/b"],
    ["the add link", "https://x.ai/bot/abc123"],
    ["a path trick", "https://x.ai/bot/marketplace/bots/../../etc"],
    ["an empty string", ""],
    ["a bare id with bad characters", "a b"],
    ["a bare id in capitals", "DR-EXAMPLE"],
    ["a file path", "../../etc/passwd"],
  ])("refuses %s", (_n, input) => {
    expect(() => parseGrokUrl(input)).toThrow(ImportError);
    try {
      parseGrokUrl(input);
    } catch (e) {
      expect((e as ImportError).code).toBe("BAD_URL");
    }
  });
});

describe("parseGrokBots", () => {
  test("reads a bot out of one chunk", () => {
    const bots = parseGrokBots(page(flight(bot("alpha"))));
    expect(bots.map((b) => b.id)).toEqual(["alpha"]);
    expect(bots[0]).toMatchObject({
      name: "Example alpha",
      creatorName: "Example Creator",
      addHref: "/bot/alpha-add",
      memories: [{ name: "memory 1", description: "A fact the bot knows." }],
      skills: [{ name: "Do a thing", content: "Use this to do a thing." }],
      routines: [{ name: "daily-check" }],
      integrations: [{ name: "Calendar" }],
    });
  });

  test("ignores objects that are not bots", () => {
    expect(parseGrokBots(page(flight(bot("alpha")))).map((b) => b.id)).toEqual(["alpha"]);
  });

  test("reads every bot of an index page", () => {
    const ids = ["alpha", "beta", "gamma", "delta"];
    const found = parseGrokBots(page(flight(...ids.map((id) => bot(id))), 3));
    expect(found.map((b) => b.id)).toEqual(ids);
  });

  test("an object cut in two chunks is put back together", () => {
    const found = parseGrokBots(page(flight(bot("alpha"), bot("beta")), 7));
    expect(found.map((b) => b.id)).toEqual(["alpha", "beta"]);
  });

  test("braces, quotes and escapes inside text do not confuse it", () => {
    const tricky = 'Use {curly} and "quotes" and a back\\slash, then [brackets] and {"id":"fake"}.';
    const found = parseGrokBots(
      page(
        flight(
          bot("alpha", {
            description: tricky,
            memories: [{ id: "m", name: "n", description: tricky }],
          }),
        ),
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.description).toBe(tricky);
    expect(found[0]!.memories[0]!.description).toBe(tricky);
  });

  test("unicode and emoji survive", () => {
    const found = parseGrokBots(page(flight(bot("alpha", { name: "Ação ✨ 日本語" }))));
    expect(found[0]!.name).toBe("Ação ✨ 日本語");
  });

  test("a bot listed twice is returned once", () => {
    expect(parseGrokBots(page(flight(bot("alpha"), bot("alpha")))).map((b) => b.id)).toEqual([
      "alpha",
    ]);
  });

  test("missing optional parts become empty, not an error", () => {
    const minimal = {
      id: "alpha",
      name: "Example",
      description: "d",
      addHref: "/bot/x",
      memories: [],
    };
    const [only] = parseGrokBots(page(flight(minimal)));
    expect(only).toMatchObject({
      id: "alpha",
      skills: [],
      routines: [],
      integrations: [],
      categories: [],
      creatorName: "",
    });
  });

  test("a null handle and image are kept as null", () => {
    const [only] = parseGrokBots(page(flight(bot("alpha", { handle: null, imageUrl: null }))));
    expect(only!.handle).toBeNull();
    expect(only!.imageUrl).toBeNull();
  });

  test("overlong lists and texts are cut, never rejected", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `m${i}`,
      name: `m${i}`,
      description: "x".repeat(10_000),
    }));
    const [only] = parseGrokBots(
      page(flight(bot("alpha", { memories: many, description: "y".repeat(50_000) }))),
    );
    expect(only!.memories.length).toBeLessThanOrEqual(100);
    expect(only!.memories[0]!.description.length).toBeLessThanOrEqual(4000);
    expect(only!.description.length).toBeLessThanOrEqual(5000);
  });

  test("a page with no bot data is PAGE_CHANGED, never an empty guess", () => {
    expect(() => parseGrokBots("<html><body>hello</body></html>")).toThrow(ImportError);
    try {
      parseGrokBots(page('1a:["$","div",null,{"nothing":"here"}]\n'));
    } catch (e) {
      expect((e as ImportError).code).toBe("PAGE_CHANGED");
    }
  });

  test("an object that looks like a bot but lacks a name is skipped; if nothing is left it is PAGE_CHANGED", () => {
    const broken = { id: "alpha", addHref: "/bot/x", memories: [] };
    expect(() => parseGrokBots(page(flight(broken)))).toThrow(ImportError);
    expect(parseGrokBots(page(flight(broken, bot("beta")))).map((b) => b.id)).toEqual(["beta"]);
  });

  test("truncated JSON does not throw anything but PAGE_CHANGED", () => {
    const text = flight(bot("alpha")).slice(0, 200);
    expect(() => parseGrokBots(page(text))).toThrow(ImportError);
  });
});

describe("createGrokSource", () => {
  const html = (...bots: unknown[]) => page(flight(...bots));

  test("get reads the bot of a page URL and asks only x.ai for it", async () => {
    const asked: string[] = [];
    const source = createGrokSource({
      fetch: async (url) => {
        asked.push(url);
        return html(bot("alpha"), bot("related"));
      },
    });
    const found = await source.get("https://x.ai/bot/marketplace/bots/alpha");
    expect(found.id).toBe("alpha");
    expect(asked).toEqual(["https://x.ai/bot/marketplace/bots/alpha"]);
  });

  test("get takes a bare id too", async () => {
    const source = createGrokSource({ fetch: async () => html(bot("alpha")) });
    expect((await source.get("alpha")).id).toBe("alpha");
  });

  test("get refuses a bad URL before fetching anything", async () => {
    let called = false;
    const source = createGrokSource({
      fetch: async () => {
        called = true;
        return "";
      },
    });
    await expect(
      source.get("https://evil.example.invalid/bot/marketplace/bots/a"),
    ).rejects.toMatchObject({ code: "BAD_URL" });
    expect(called).toBe(false);
  });

  test("when the page holds several bots, get picks the one asked for", async () => {
    const source = createGrokSource({ fetch: async () => html(bot("other"), bot("alpha")) });
    expect((await source.get("alpha")).id).toBe("alpha");
  });

  test("a page that holds only one bot with another id is still that bot (a renamed link)", async () => {
    const source = createGrokSource({ fetch: async () => html(bot("alpha-v2")) });
    expect((await source.get("alpha")).id).toBe("alpha-v2");
  });

  test("a page of several bots without the one asked for is NOT_FOUND", async () => {
    const source = createGrokSource({ fetch: async () => html(bot("one"), bot("two")) });
    await expect(source.get("alpha")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a fetch failure is passed up as it is", async () => {
    const source = createGrokSource({
      fetch: async () => {
        throw new ImportError("FETCH_FAILED", "down");
      },
    });
    await expect(source.get("alpha")).rejects.toMatchObject({ code: "FETCH_FAILED" });
  });

  test("list reads the index, and a second call inside 10 minutes does not fetch again", async () => {
    let calls = 0;
    let clock = 1_000_000;
    const source = createGrokSource({
      fetch: async (url) => {
        calls++;
        expect(url).toBe("https://x.ai/bot/marketplace");
        return html(bot("alpha"), bot("beta"));
      },
      now: () => clock,
    });
    expect((await source.list()).map((b) => b.id)).toEqual(["alpha", "beta"]);
    clock += 9 * 60_000;
    await source.list();
    expect(calls).toBe(1);
    clock += 2 * 60_000;
    await source.list();
    expect(calls).toBe(2);
  });

  test("a failed list is not cached", async () => {
    let calls = 0;
    const source = createGrokSource({
      fetch: async () => {
        calls++;
        if (calls === 1) throw new ImportError("FETCH_FAILED", "down");
        return html(bot("alpha"));
      },
    });
    await expect(source.list()).rejects.toMatchObject({ code: "FETCH_FAILED" });
    expect((await source.list()).map((b) => b.id)).toEqual(["alpha"]);
  });

  test("list items carry what is needed to choose a bot and none of the long text", async () => {
    const source = createGrokSource({ fetch: async () => html(bot("alpha")) });
    const [item] = await source.list();
    expect(item).toMatchObject({
      id: "alpha",
      name: "Example alpha",
      creatorName: "Example Creator",
      summary: "Summary of alpha.",
      categories: ["Research"],
      avatar: {
        kind: "preset",
        preset: "circle",
        colors: [expect.stringMatching(/^#[0-9a-f]{6}$/)],
      },
    });
    for (const long of ["memories", "skills", "routines", "integrations", "instructions", "counts"])
      expect(item).not.toHaveProperty(long);
  });

  test("the real index leaves memories, skills, routines and integrations empty; it still lists the bot", async () => {
    // Observed on the live index page: the keys are there, the arrays are empty. Only a bot's own page fills them.
    const hollow = bot("alpha", { memories: [], skills: [], routines: [], integrations: [] });
    const source = createGrokSource({ fetch: async () => html(hollow) });
    expect((await source.list()).map((b) => b.id)).toEqual(["alpha"]);
  });
});
