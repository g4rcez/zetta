import { describe, expect, test } from "bun:test";
import { buildInfo, parseBuild } from "./build-info";
import { createUpdateChecker, DEFAULT_UPDATE_FEED, type UpdateVerdict } from "./checker";

const FEED = [
  {
    day: "2026-11-12",
    entries: [{ type: "feat", scope: "chat", subject: "polls", sha: "bffe149" }],
  },
  {
    day: "2026-11-10",
    entries: [{ type: "fix", scope: "web", subject: "old fix", sha: "54121d6" }],
  },
];
const BUILD = { commit: "54121d6", date: "2026-11-10T12:00:00.000Z" };

type Call = { url: string; init: RequestInit | undefined };
function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

function checker(
  over: Partial<Parameters<typeof createUpdateChecker>[0]> & { feed?: () => Response },
) {
  const { feed, ...rest } = over;
  const f = fakeFetch(feed ?? (() => json(FEED)));
  const verdicts: UpdateVerdict[] = [];
  let clock = Date.parse("2026-11-16T00:00:00Z");
  const c = createUpdateChecker({
    build: BUILD,
    mode: async () => "on",
    fetch: f.fetcher,
    now: () => clock,
    onVerdict: async (v) => void verdicts.push(v),
    ...rest,
  });
  return { c, calls: f.calls, verdicts, advance: (ms: number) => (clock += ms) };
}

describe("buildInfo", () => {
  test("reads the stamp the installer set", () => {
    expect(
      buildInfo(
        { ZETTA_BUILD_COMMIT: "54121D6abcdef0123", ZETTA_BUILD_DATE: "2026-11-16T21:37:03-03:00" },
        () => {
          throw new Error("git must not run");
        },
      ),
    ).toEqual({ commit: "54121d6abcde", date: "2026-11-17T00:37:03.000Z" });
  });
  test("falls back to git in a checkout, and to null when git fails or says nonsense", () => {
    expect(buildInfo({}, () => "abc1234\n2026-11-16T21:37:03-03:00\n")).toEqual({
      commit: "abc1234",
      date: "2026-11-17T00:37:03.000Z",
    });
    expect(buildInfo({}, () => undefined)).toBeNull();
    expect(buildInfo({}, () => "not a commit\nnot a date\n")).toBeNull();
  });
  test("a half stamp does not count", () => {
    expect(parseBuild("abc1234", "")).toBeNull();
    expect(parseBuild("", "2026-11-16T00:00:00Z")).toBeNull();
    expect(parseBuild("xyz", "2026-11-16T00:00:00Z")).toBeNull();
  });
});

describe("update checker", () => {
  test("one plain GET to the public feed: no body, no identifier, no cookies, no redirect to follow blindly", async () => {
    const { c, calls } = checker({});
    await c.tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(DEFAULT_UPDATE_FEED);
    const init = calls[0]!.init!;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("omit");
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["accept"]);
  });
  test("a build older than the newest day is behind, with the changes since it", async () => {
    const { c, verdicts } = checker({});
    await c.tick();
    const s = await c.status();
    expect(s.state).toBe("behind");
    expect(s.latest).toEqual({ date: "2026-11-12" });
    expect(s.changes.map((x) => x.subject)).toEqual(["polls"]);
    expect(s.checkedAt).toBe("2026-11-16T00:00:00.000Z");
    expect(s.check).toBe("on");
    expect(s.build).toEqual(BUILD);
    expect(verdicts).toEqual([{ state: "behind", latest: { date: "2026-11-12" } }]);
  });
  test("a build on the newest day is current", async () => {
    const { c } = checker({ build: { commit: "bffe149", date: "2026-11-12T08:00:00.000Z" } });
    await c.tick();
    expect((await c.status()).state).toBe("current");
  });
  test("without a build stamp the state is unknown", async () => {
    const { c } = checker({ build: null });
    await c.tick();
    expect((await c.status()).state).toBe("unknown");
  });
  test("it checks once a day, not on every tick", async () => {
    const { c, calls, advance } = checker({});
    await c.tick();
    await c.tick();
    advance(23 * 3600_000);
    await c.tick();
    expect(calls).toHaveLength(1);
    advance(2 * 3600_000);
    await c.tick();
    expect(calls).toHaveLength(2);
  });
  test("a failure never throws, keeps the last good answer and retries in an hour", async () => {
    let fail = false;
    const { c, calls, advance } = checker({
      feed: () => (fail ? new Response("nope", { status: 500 }) : json(FEED)),
    });
    await c.tick();
    fail = true;
    advance(25 * 3600_000);
    await c.tick();
    await c.tick();
    expect(calls).toHaveLength(2);
    expect((await c.status()).state).toBe("behind");
    advance(61 * 60_000);
    fail = false;
    await c.tick();
    expect(calls).toHaveLength(3);
  });
  test("bad JSON, a network error and an answer that is not a list all end as unknown", async () => {
    for (const feed of [
      () => new Response("<html>", { status: 200 }),
      () => {
        throw new Error("offline");
      },
      () => json({ not: "a list" }),
    ]) {
      const { c } = checker({ feed });
      await c.tick();
      expect((await c.status()).state).toBe("unknown");
    }
  });
  test("an answer over the size cap is refused", async () => {
    const big = new Response("[" + "0,".repeat(400_000) + "0]", { status: 200 });
    const { c } = checker({ feed: () => big });
    await c.tick();
    expect((await c.status()).state).toBe("unknown");
  });
  test("a redirect is followed up to three times; a loop is refused", async () => {
    let n = 0;
    const { c, calls } = checker({
      feed: () => {
        n += 1;
        return n <= 2
          ? new Response(null, {
              status: 301,
              headers: { location: "https://www.zettabot.app/changelog.json" },
            })
          : json(FEED);
      },
    });
    await c.tick();
    expect(calls).toHaveLength(3);
    expect(calls[1]!.url).toBe("https://www.zettabot.app/changelog.json");
    expect((await c.status()).state).toBe("behind");
    const loop = checker({
      feed: () => new Response(null, { status: 302, headers: { location: DEFAULT_UPDATE_FEED } }),
    });
    await loop.c.tick();
    expect(loop.calls).toHaveLength(4);
    expect((await loop.c.status()).state).toBe("unknown");
  });
  test("the installation setting off sends nothing and says so", async () => {
    const { c, calls, verdicts } = checker({ mode: async () => "off" });
    await c.tick();
    const s = await c.status();
    expect(calls).toHaveLength(0);
    expect(s).toMatchObject({ check: "off", state: "unknown", checkedAt: null, changes: [] });
    expect(verdicts).toEqual([null]);
    await c.tick();
    expect(verdicts).toHaveLength(1);
  });
  test("the operator's switch wins over the setting", async () => {
    const { c, calls } = checker({ operatorOff: true, mode: async () => "on" });
    await c.tick();
    expect(calls).toHaveLength(0);
    expect((await c.status()).check).toBe("off");
  });
  test("turning the setting off drops what was known; turning it on checks at once", async () => {
    let mode: "on" | "off" = "on";
    const { c, calls } = checker({ mode: async () => mode });
    await c.tick();
    mode = "off";
    await c.tick();
    expect((await c.status()).state).toBe("unknown");
    mode = "on";
    await c.tick();
    expect(calls).toHaveLength(2);
    expect((await c.status()).state).toBe("behind");
  });
  test("an address from the operator must pass the private-network check; the default one is not looked up", async () => {
    const refused: string[] = [];
    const guard = async (url: string) => {
      refused.push(url);
      throw new Error("BLOCKED_URL");
    };
    const custom = checker({ feedUrl: "https://feed.example.invalid/c.json", assertPublic: guard });
    await custom.c.tick();
    expect(refused).toEqual(["https://feed.example.invalid/c.json"]);
    expect(custom.calls).toHaveLength(0);
    const stock = checker({ assertPublic: guard });
    await stock.c.tick();
    expect(stock.calls).toHaveLength(1);
    const allowed = checker({
      feedUrl: "http://10.0.0.5/changelog.json",
      assertPublic: guard,
      allowPrivate: true,
    });
    await allowed.c.tick();
    expect(allowed.calls).toHaveLength(1);
  });
  test("an operator address must be https unless private networks are allowed", async () => {
    const { c, calls } = checker({
      feedUrl: "http://feed.example.invalid/c.json",
      assertPublic: async () => {},
    });
    await c.tick();
    expect(calls).toHaveLength(0);
  });
  test("a process that does not run the ticker checks when asked, once a day", async () => {
    const { c, calls, advance } = checker({ lazy: true });
    await c.status();
    await c.status();
    expect(calls).toHaveLength(1);
    advance(25 * 3600_000);
    await c.status();
    expect(calls).toHaveLength(2);
  });
  test("a card that cannot be raised does not break the check", async () => {
    const { c } = checker({
      onVerdict: async () => {
        throw new Error("db down");
      },
    });
    await c.tick();
    expect((await c.status()).state).toBe("behind");
  });
});
