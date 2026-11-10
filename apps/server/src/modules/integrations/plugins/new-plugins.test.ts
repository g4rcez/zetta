import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applePlugin, setAppleExec } from "./apple";
import { CANVA } from "./canva";
import { elevenlabsPlugin } from "./elevenlabs";
import { setInstallMode } from "./local-only";
import { startOAuth, finishOAuth } from "./oauth2";
import { obsidianPlugin } from "./obsidian";
import type { PluginContext, PluginDef } from "./registry";
import { readOnlySql, supabasePlugin } from "./supabase";
import { trelloPlugin } from "./trello";
import { vercelPlugin } from "./vercel";

const realFetch = globalThis.fetch;
type Seen = { url: string; method: string; headers: Headers; body: string };
let seen: Seen[] = [];
let reply: (u: URL) => Response = () => Response.json({});
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
    });
    return reply(new URL(url));
  }) as typeof fetch;
});
afterEach(() => {
  seen = [];
  reply = () => Response.json({});
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
const ctx = (config: Record<string, string>): PluginContext & { saved: Record<string, string> } => {
  const c = {
    userId: "plugin-test-user",
    config,
    saved: config,
    async setConfig(next: Record<string, string>) {
      c.config = next;
      c.saved = next;
    },
  };
  return c as never;
};
const tool = (p: PluginDef, name: string) => p.tools!.find((t) => t.name === name)!;

describe("Trello", () => {
  test("sends key and token as the API expects, and maps cards", async () => {
    reply = () =>
      Response.json({
        cards: [{ id: "c1", name: "Ship it", idList: "l1", url: "https://trello.com/c/c1" }],
      });
    const out = await tool(trelloPlugin, "search").handler(ctx({ apiKey: "k", token: "t" }), {
      query: "ship",
    });
    expect(out).toEqual([
      {
        id: "c1",
        name: "Ship it",
        list: "l1",
        due: null,
        url: "https://trello.com/c/c1",
        desc: undefined,
      },
    ]);
    const u = new URL(seen[0]!.url);
    expect(u.origin + u.pathname).toBe("https://api.trello.com/1/search");
    expect(u.searchParams.get("key")).toBe("k");
    expect(u.searchParams.get("token")).toBe("t");
  });
  test("an id with a slash never reaches the path; a refused key says what to fix", async () => {
    await expect(
      tool(trelloPlugin, "lists").handler(ctx({ apiKey: "k", token: "t" }), { boardId: "../x" }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
    reply = () => new Response("no", { status: 401 });
    await expect(
      tool(trelloPlugin, "boards").handler(ctx({ apiKey: "k", token: "t" }), {}),
    ).rejects.toMatchObject({
      code: "NEEDS_AUTH",
    });
  });
});

describe("ElevenLabs", () => {
  let home: string;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "zetta-out-"));
    process.env.ZETTA_CODE_ROOT = home;
  });
  afterAll(async () => {
    delete process.env.ZETTA_CODE_ROOT;
    await rm(home, { recursive: true, force: true });
  });
  test("speak saves the mp3 in the user's code folder and returns its path; the key is a header", async () => {
    reply = () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    const out = (await tool(elevenlabsPlugin, "speak").handler(ctx({ apiKey: "xi" }), {
      voiceId: "voice_1",
      text: "Hello",
    })) as { saved: string; bytes: number };
    expect(out.bytes).toBe(3);
    expect(out.saved).toMatch(/^outputs\/elevenlabs\/.*speech\.mp3$/);
    expect([...(await readFile(join(home, "plugin-test-user", out.saved)))]).toEqual([1, 2, 3]);
    expect(seen[0]!.url).toStartWith("https://api.elevenlabs.io/v1/text-to-speech/voice_1");
    expect(seen[0]!.headers.get("xi-api-key")).toBe("xi");
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ text: "Hello" });
  });
});

describe("Vercel", () => {
  test("lists env var names only, never values", async () => {
    reply = () =>
      Response.json({
        envs: [{ key: "DATABASE_URL", value: "postgres://secret", target: ["production"] }],
      });
    const out = await tool(vercelPlugin, "env_names").handler(ctx({ token: "v" }), {
      projectId: "prj_1",
    });
    expect(out).toEqual([{ name: "DATABASE_URL", targets: ["production"] }]);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer v");
  });
  test("a team id goes on every call", async () => {
    reply = () => Response.json({ projects: [] });
    await tool(vercelPlugin, "projects").handler(ctx({ token: "v", teamId: "team_9" }), {});
    expect(new URL(seen[0]!.url).searchParams.get("teamId")).toBe("team_9");
  });
});

describe("Supabase", () => {
  test("SQL is read-only unless writes are allowed", async () => {
    expect(readOnlySql("select * from users")).toBe(true);
    expect(readOnlySql("with x as (select 1) select * from x;")).toBe(true);
    expect(readOnlySql("delete from users")).toBe(false);
    expect(readOnlySql("select 1; drop table users")).toBe(false);
    expect(readOnlySql("select 1 /* ; */ ")).toBe(true);
    expect(readOnlySql("-- note\nupdate users set a = 1")).toBe(false);
    await expect(
      tool(supabasePlugin, "sql").handler(ctx({ token: "s" }), {
        ref: "abc",
        query: "delete from t",
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(seen).toHaveLength(0);
    reply = () => Response.json([{ n: 1 }]);
    expect(
      await tool(supabasePlugin, "sql").handler(ctx({ token: "s", writes: "on" }), {
        ref: "abc",
        query: "delete from t",
      }),
    ).toEqual([{ n: 1 }]);
    expect(seen[0]!.url).toBe("https://api.supabase.com/v1/projects/abc/database/query");
  });
});

describe("Obsidian", () => {
  let vault: string;
  beforeAll(async () => {
    vault = await mkdtemp(join(tmpdir(), "zetta-vault-"));
    await mkdir(join(vault, "Projects"));
    await writeFile(join(vault, "Projects", "Plan.md"), "# Plan\nShip the [[Roadmap]] by Friday");
    await writeFile(join(vault, "Roadmap.md"), "Q4 goals");
  });
  afterAll(async () => {
    setInstallMode("network");
    await rm(vault, { recursive: true, force: true });
  });
  test("refused on a server open to the network", async () => {
    setInstallMode("network");
    await expect(tool(obsidianPlugin, "list").handler(ctx({ vault }), {})).rejects.toMatchObject({
      code: "LOCAL_ONLY",
    });
  });
  test("search, read, write, append and backlinks stay inside the vault", async () => {
    setInstallMode("local");
    const c = ctx({ vault });
    expect(await tool(obsidianPlugin, "search").handler(c, { query: "friday" })).toEqual([
      { path: "Projects/Plan.md", line: "Ship the [[Roadmap]] by Friday" },
    ]);
    expect(await tool(obsidianPlugin, "backlinks").handler(c, { path: "Roadmap" })).toEqual([
      "Projects/Plan.md",
    ]);
    await tool(obsidianPlugin, "write").handler(c, { path: "Inbox/Idea", content: "x" });
    await expect(
      tool(obsidianPlugin, "write").handler(c, { path: "Inbox/Idea", content: "y" }),
    ).rejects.toMatchObject({
      code: "EXISTS",
    });
    await tool(obsidianPlugin, "append").handler(c, { path: "Inbox/Idea", content: "more" });
    expect(await tool(obsidianPlugin, "read").handler(c, { path: "Inbox/Idea.md" })).toContain(
      "more",
    );
    for (const path of ["../outside", "/etc/passwd", "Projects/../../x"])
      await expect(tool(obsidianPlugin, "read").handler(c, { path })).rejects.toMatchObject({
        code: "INVALID_ARGS",
      });
    await symlink(tmpdir(), join(vault, "escape"));
    await expect(
      tool(obsidianPlugin, "write").handler(c, { path: "escape/x", content: "no" }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });
});

describe("Apple apps", () => {
  afterAll(() => setInstallMode("network"));
  test("values go as arguments, never inside the script", async () => {
    setInstallMode("local");
    const calls: string[][] = [];
    setAppleExec(async (cmd) => {
      calls.push(cmd);
      return { code: 0, stdout: `Buy milk\u001f2026-11-12T09:00:00`, stderr: "" };
    });
    if (process.platform !== "darwin") {
      await expect(tool(applePlugin, "reminders_list").handler(ctx({}), {})).rejects.toMatchObject({
        code: "WRONG_PLATFORM",
      });
      return;
    }
    const evil = '" & (do shell script "rm -rf ~") & "';
    expect(await tool(applePlugin, "notes_search").handler(ctx({}), { query: evil })).toEqual([
      { name: "Buy milk", start: "2026-11-12T09:00:00" },
    ]);
    const [cmd] = calls;
    expect(cmd![0]).toBe("osascript");
    expect(cmd![2]).not.toContain("rm -rf");
    expect(cmd!.at(-1)).toBe(evil);
  });
  test("a call cut off while macOS waits on its Allow prompt says to click Allow", async () => {
    if (process.platform !== "darwin") return;
    setInstallMode("local");
    setAppleExec(async () => ({ code: 143, stdout: "", stderr: "", timedOut: true }));
    await expect(tool(applePlugin, "reminders_list").handler(ctx({}), {})).rejects.toMatchObject({
      code: "NEEDS_AUTH",
      fix: expect.stringContaining("Click Allow"),
    });
  });
  test("a refused Automation permission says where to allow it", async () => {
    if (process.platform !== "darwin") return;
    setInstallMode("local");
    setAppleExec(async () => ({
      code: 1,
      stdout: "",
      stderr: "Not authorized to send Apple events to Notes. (-1743)",
    }));
    await expect(
      tool(applePlugin, "notes_create").handler(ctx({}), { title: "a", body: "b" }),
    ).rejects.toMatchObject({
      code: "NEEDS_AUTH",
    });
  });
});

describe("Canva OAuth (shared oauth2 helper)", () => {
  test("PKCE start, single-use state, code exchange with Basic auth, sealed tokens", async () => {
    process.env.ZETTA_OAUTH_REDIRECT_BASE = "https://zetta.example.invalid";
    const c = ctx({ clientId: "cid", clientSecret: "csec" });
    const { authorizeUrl } = await startOAuth(CANVA, c);
    const u = new URL(authorizeUrl);
    expect(u.origin + u.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://zetta.example.invalid/api/plugins/canva/callback",
    );
    const state = u.searchParams.get("state")!;
    reply = () => Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    await finishOAuth(CANVA, c, new URLSearchParams({ state, code: "the-code" }));
    expect(c.saved).toMatchObject({ accessToken: "at", refreshToken: "rt", clientId: "cid" });
    expect(c.saved.pending).toBeUndefined();
    expect(seen[0]!.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("cid:csec").toString("base64")}`,
    );
    expect(seen[0]!.body).toContain("code_verifier=");
    // The same link cannot be used twice.
    await expect(
      finishOAuth(CANVA, c, new URLSearchParams({ state, code: "again" })),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    delete process.env.ZETTA_OAUTH_REDIRECT_BASE;
  });
});
