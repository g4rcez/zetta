import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../registry";
import { createTokenStore } from "../token-store";
import { createApprovals } from "./approvals";
import { createCompanion, deviceNameFrom, type SocketLike } from "./client";
import { listFolder, runCommand, shellFor, type Spawn } from "./exec";
import { createGrants, guardedWords } from "./policy";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zetta-companion-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("guarded commands", () => {
  test("deletes, root and mail are found anywhere in a command line", () => {
    expect(guardedWords("ls -la")).toEqual([]);
    expect(guardedWords("rm -rf build")).toEqual(["rm"]);
    expect(guardedWords("cd x && sudo apt install y; echo ok")).toEqual(["sudo"]);
    expect(guardedWords("cat a | mail bob")).toEqual(["mail"]);
    expect(guardedWords("/bin/rm file")).toEqual(["rm"]);
    expect(guardedWords("echo $(rmdir d)")).toEqual(["rmdir"]);
    expect(guardedWords("RM file")).toEqual(["rm"]);
  });
  test("a word that only contains one is not a match", () => {
    expect(guardedWords("npm run format-check && git status")).toEqual([]);
    expect(guardedWords("cat rmfile.txt farm.log")).toEqual([]);
    expect(guardedWords("echo storm")).toEqual([]);
  });
});

describe("grants", () => {
  test("are kept in a private file, per server and bot, and can be taken back", () => {
    const file = join(root, "grants.json");
    const grants = createGrants(file);
    expect(grants.allows("s1", "b1")).toBe(false);
    grants.allow("s1", "b1");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(createGrants(file).allows("s1", "b1")).toBe(true);
    expect(createGrants(file).allows("s1", "b2")).toBe(false);
    expect(grants.revoke("s1", "b1")).toBe(true);
    expect(grants.revoke("s1", "b1")).toBe(false);
    grants.allow("s2", "b1");
    grants.revokeServer("s2");
    expect(grants.list()).toEqual([]);
  });
  test("a damaged file is moved aside and everything asks again", () => {
    const file = join(root, "grants.json");
    writeFileSync(file, "{ nope");
    expect(createGrants(file, () => 9).allows("s", "b")).toBe(false);
    expect(statSync(`${file}.unreadable-9`).isFile()).toBe(true);
  });
});

describe("approvals", () => {
  test("wait for an answer and pass it on; unknown ids are refused", async () => {
    const approvals = createApprovals({ newId: () => "a1" });
    const asked = approvals.ask({
      serverName: "Cloud",
      bot: "ops",
      method: "run",
      detail: "ls",
      guarded: [],
    });
    expect(approvals.list()).toHaveLength(1);
    expect(approvals.decide("a1", "once")).toBe(true);
    expect(await asked).toBe("once");
    expect(approvals.decide("a1", "once")).toBe(false);
    expect(approvals.list()).toEqual([]);
  });
  test("a guarded command can only be allowed once, whatever is pressed", async () => {
    const approvals = createApprovals({ newId: () => "a1" });
    const asked = approvals.ask({
      serverName: "Cloud",
      bot: "ops",
      method: "run",
      detail: "rm x",
      guarded: ["rm"],
    });
    approvals.decide("a1", "always");
    expect(await asked).toBe("once");
  });
  test("no answer in time is a refusal", async () => {
    const approvals = createApprovals({ timeoutMs: 20 });
    expect(
      await approvals.ask({ serverName: "C", bot: "b", method: "run", detail: "ls", guarded: [] }),
    ).toBe("deny");
  });
  test("denyAll refuses everything that waits, and every change is reported", async () => {
    const seen: number[] = [];
    const approvals = createApprovals({ onChange: (all) => seen.push(all.length) });
    const one = approvals.ask({
      serverName: "C",
      bot: "b",
      method: "run",
      detail: "a",
      guarded: [],
    });
    const two = approvals.ask({
      serverName: "C",
      bot: "b",
      method: "run",
      detail: "b",
      guarded: [],
    });
    approvals.denyAll();
    expect(await Promise.all([one, two])).toEqual(["deny", "deny"]);
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});

describe("running commands", () => {
  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
  const spawnOf =
    (out: string, err = "", code = 0): Spawn =>
    () => ({ stdout: stream(out), stderr: stream(err), exited: Promise.resolve(code), kill() {} });

  test("takes both outputs and the exit code, in the shell of the system", async () => {
    let seen: string[] = [];
    const result = await runCommand("echo hi", {
      spawn: (command) => ((seen = command), spawnOf("hi\n", "warn\n", 3)(command, {} as never)),
    });
    expect(result).toEqual({ exitCode: 3, output: "hi\nwarn\n", truncated: false });
    expect(seen).toEqual(["/bin/sh", "-c", "echo hi"]);
    expect(shellFor("win32")[0]).toBe("cmd.exe");
  });
  test("output is capped", async () => {
    const result = await runCommand("yes", { spawn: spawnOf("x".repeat(200_000)) });
    expect(result.output).toHaveLength(64 * 1024);
    expect(result.truncated).toBe(true);
  });
  test("the app's own environment does not reach the command", async () => {
    let env: Record<string, string> = {};
    await runCommand("env", {
      env: { PATH: "/bin", HOME: "/h", ZETTA_SECRET: "leak", ANTHROPIC_API_KEY: "sk-test" },
      spawn: (_c, o) => ((env = o.env), spawnOf("")(_c, o)),
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });
  test("a command that runs too long is stopped", async () => {
    const hang: Spawn = (_c, { signal }) => {
      const gate = new Promise<number>((resolve) =>
        signal.addEventListener("abort", () => resolve(137)),
      );
      return { stdout: stream(""), stderr: stream(""), exited: gate, kill() {} };
    };
    const result = await runCommand("sleep 99", { spawn: hang, timeoutMs: 30 });
    expect(result.exitCode).toBe(124);
  });
  test("a program that cannot start is reported", async () => {
    const result = await runCommand("x", {
      spawn: () => {
        throw new Error("ENOENT");
      },
    });
    expect(result).toMatchObject({ exitCode: 127 });
  });
  test("a real command runs for real", async () => {
    const result = await runCommand("echo real-run", { cwd: root });
    expect(result).toEqual({ exitCode: 0, output: "real-run\n", truncated: false });
  });
  test("lists a folder", async () => {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "a.txt"), "12345");
    expect(await listFolder(root)).toEqual({
      exitCode: 0,
      output: "- a.txt 5\nd sub",
      truncated: false,
    });
    expect((await listFolder(join(root, "missing"))).exitCode).toBe(1);
    expect(await listFolder("sub", root)).toEqual({ exitCode: 0, output: "", truncated: false });
  });
});

describe("device name", () => {
  test("is made from the host name in a form the server accepts", () => {
    expect(deviceNameFrom("Allans-MacBook-Pro.local")).toBe("Allans-MacBook-Pro");
    expect(deviceNameFrom("my/odd:name!")).toBe("my odd name");
    expect(deviceNameFrom("***")).toBe("My computer");
    expect(deviceNameFrom("x".repeat(100))).toHaveLength(60);
  });
});

/** A socket the test controls: the server's side sends with `receive`, and what the app sent is in `sent`. */
function fakeSocket() {
  const s = {
    sent: [] as string[],
    closed: false,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  } as unknown as SocketLike & {
    sent: string[];
    closed: boolean;
    receive(m: unknown): void;
    open(): void;
    drop(): void;
  };
  s.send = (d) => void s.sent.push(d);
  s.close = () => {
    s.closed = true;
    s.onclose?.({});
  };
  s.receive = (m) => s.onmessage?.({ data: JSON.stringify(m) });
  s.open = () => s.onopen?.({});
  s.drop = () => s.onclose?.({});
  return s;
}

describe("companion", () => {
  function setup(options: { token?: string | null; pairStatus?: number } = {}) {
    const registry = createRegistry(join(root, "servers.json"));
    const remote = registry.add({
      name: "Cloud",
      kind: "remote",
      webOrigin: "https://cloud.example.invalid",
      apiOrigin: "https://cloud.example.invalid",
    });
    const tokens = createTokenStore(join(root, "tokens.json"));
    tokens.set(remote.id, { accessToken: "a", refreshToken: "r", expiresAt: 9e15, scope: "x" });
    const grants = createGrants(join(root, "grants.json"));
    const approvals = createApprovals({
      newId: (() => {
        let n = 0;
        return () => `p${++n}`;
      })(),
    });
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const urls: { url: string; credential: string }[] = [];
    const posts: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const ran: string[] = [];
    let attention = 0;
    const companion = createCompanion({
      registry,
      tokens,
      grants,
      approvals,
      accessToken: async () => (options.token === undefined ? "access-1" : options.token),
      fetcher: (async (url: string, init: RequestInit) => {
        posts.push({
          url,
          headers: init.headers as Record<string, string>,
          body: JSON.parse(String(init.body)),
        });
        return options.pairStatus && options.pairStatus !== 200
          ? new Response("{}", { status: options.pairStatus })
          : Response.json({ device: { id: "dev-1" }, credential: "zdv_secret" });
      }) as never,
      socket: (url, credential) => {
        const s = fakeSocket();
        sockets.push(s);
        urls.push({ url, credential });
        return s;
      },
      hostname: () => "Work-Mac.local",
      platform: () => "darwin",
      run: async (command) => (
        ran.push(command),
        { exitCode: 0, output: `ran ${command}`, truncated: false }
      ),
      list: async (path) => ({ exitCode: 0, output: `listed ${path}`, truncated: false }),
      sleep: async () => {},
      attention: () => void attention++,
    });
    return {
      companion,
      registry,
      remote,
      tokens,
      grants,
      approvals,
      sockets,
      urls,
      posts,
      ran,
      attention: () => attention,
    };
  }
  const answers = (s: { sent: string[] }) =>
    s.sent.filter((x) => x !== "ping").map((x) => JSON.parse(x));
  const request = (
    s: ReturnType<typeof fakeSocket>,
    id: string,
    method: string,
    params: Record<string, unknown>,
  ) => s.receive({ id, method, params });
  const settle = () => Bun.sleep(5);

  test("turning sharing on pairs with the sign-in the app has, keeps the credential and connects with it", async () => {
    const s = setup();
    expect(await s.companion.enable(s.remote.id)).toBe(true);
    expect(s.posts[0]).toMatchObject({
      url: "https://cloud.example.invalid/api/devices",
      headers: { authorization: "Bearer access-1" },
      body: { name: "Work-Mac", platform: "darwin" },
    });
    expect(s.tokens.getDevice(s.remote.id)).toEqual({
      deviceId: "dev-1",
      credential: "zdv_secret",
      enabled: true,
    });
    expect(s.urls).toEqual([
      { url: "wss://cloud.example.invalid/api/devices/connect", credential: "zdv_secret" },
    ]);
    s.sockets[0]!.open();
    expect(s.companion.state(s.remote.id)).toEqual({
      enabled: true,
      connected: true,
      paused: false,
    });
  });

  test("a server that refuses, or no sign-in, leaves sharing off", async () => {
    expect(await setup({ pairStatus: 401 }).companion.enable("x")).toBe(false);
    const noSignIn = setup({ token: null });
    expect(await noSignIn.companion.enable(noSignIn.remote.id)).toBe(false);
    expect(noSignIn.sockets).toHaveLength(0);
    expect(noSignIn.companion.state(noSignIn.remote.id).enabled).toBe(false);
  });

  test("a bot nobody allowed asks first; allowing once runs it and the next one asks again", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    const socket = s.sockets[0]!;
    socket.open();
    request(socket, "r1", "run", { command: "uname -a", bot: "ops", botId: "bot-1" });
    await settle();
    expect(s.approvals.list()).toHaveLength(1);
    expect(s.approvals.list()[0]).toMatchObject({
      serverName: "Cloud",
      bot: "ops",
      method: "run",
      detail: "uname -a",
      guarded: [],
    });
    expect(s.attention()).toBe(1);
    expect(s.ran).toEqual([]);
    s.approvals.decide("p1", "once");
    await settle();
    expect(answers(socket)).toEqual([
      { id: "r1", result: { exitCode: 0, output: "ran uname -a", truncated: false } },
    ]);
    request(socket, "r2", "run", { command: "ls", bot: "ops", botId: "bot-1" });
    await settle();
    expect(s.approvals.list()).toHaveLength(1);
  });

  test("allowing always lets that bot's ordinary commands through, but not another bot's, and never a delete", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    const socket = s.sockets[0]!;
    socket.open();
    request(socket, "r1", "run", { command: "ls", bot: "ops", botId: "bot-1" });
    await settle();
    s.approvals.decide("p1", "always");
    await settle();
    expect(s.grants.allows(s.remote.id, "bot-1")).toBe(true);

    request(socket, "r2", "run", { command: "pwd", bot: "ops", botId: "bot-1" });
    await settle();
    expect(s.approvals.list()).toEqual([]);
    expect(s.ran).toEqual(["ls", "pwd"]);

    request(socket, "r3", "run", { command: "pwd", bot: "other", botId: "bot-2" });
    request(socket, "r4", "run", { command: "rm -rf data", bot: "ops", botId: "bot-1" });
    await settle();
    expect(s.approvals.list().map((a) => a.detail)).toEqual(["pwd", "rm -rf data"]);
    expect(s.approvals.list()[1]!.guarded).toEqual(["rm"]);
  });

  test("a refusal, or a request nobody answers, is DENIED and nothing runs", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    const socket = s.sockets[0]!;
    socket.open();
    request(socket, "r1", "run", { command: "ls", bot: "ops", botId: "bot-1" });
    await settle();
    s.approvals.decide("p1", "deny");
    await settle();
    expect(answers(socket)).toEqual([{ id: "r1", error: { code: "DENIED" } }]);
    expect(s.ran).toEqual([]);
  });

  test("a request with no bot id always asks, and anything but run and list is unsupported", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    const socket = s.sockets[0]!;
    socket.open();
    s.grants.allow(s.remote.id, "");
    request(socket, "r1", "run", { command: "ls" });
    request(socket, "r2", "put", { path: "/x" });
    request(socket, "r3", "run", { bot: "ops", botId: "bot-1" });
    await settle();
    expect(s.approvals.list()).toHaveLength(1);
    expect(answers(socket)).toEqual([
      { id: "r2", error: { code: "UNSUPPORTED" } },
      { id: "r3", error: { code: "UNSUPPORTED" } },
    ]);
  });

  test("listing asks like running does, and answers with the folder", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    const socket = s.sockets[0]!;
    socket.open();
    s.grants.allow(s.remote.id, "bot-1");
    request(socket, "r1", "list", { path: "/tmp", bot: "ops", botId: "bot-1" });
    await settle();
    expect(answers(socket)).toEqual([
      { id: "r1", result: { exitCode: 0, output: "listed /tmp", truncated: false } },
    ]);
  });

  test("pausing refuses what waits, drops the connections and refuses new requests; resuming reconnects", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    const socket = s.sockets[0]!;
    socket.open();
    request(socket, "r1", "run", { command: "ls", bot: "ops", botId: "bot-1" });
    await settle();
    s.companion.setPaused(true);
    await settle();
    expect(socket.closed).toBe(true);
    expect(answers(socket)).toEqual([{ id: "r1", error: { code: "DENIED" } }]);
    expect(s.companion.state(s.remote.id)).toEqual({
      enabled: true,
      connected: false,
      paused: true,
    });
    expect(s.sockets).toHaveLength(1);
    s.companion.setPaused(false);
    expect(s.sockets).toHaveLength(2);
  });

  test("turning sharing off closes the connection, forgets what was allowed and does not reconnect", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    s.sockets[0]!.open();
    s.grants.allow(s.remote.id, "bot-1");
    s.companion.disable(s.remote.id);
    await settle();
    expect(s.sockets[0]!.closed).toBe(true);
    expect(s.grants.allows(s.remote.id, "bot-1")).toBe(false);
    expect(s.tokens.getDevice(s.remote.id)?.enabled).toBe(false);
    expect(s.sockets).toHaveLength(1);
  });

  test("a connection that drops comes back, and start() reconnects what was on", async () => {
    const s = setup();
    await s.companion.enable(s.remote.id);
    s.sockets[0]!.open();
    s.sockets[0]!.drop();
    await settle();
    expect(s.sockets).toHaveLength(2);
    expect(s.companion.state(s.remote.id).connected).toBe(false);
    s.sockets[1]!.open();
    expect(s.companion.state(s.remote.id).connected).toBe(true);

    const again = createCompanion({
      registry: s.registry,
      tokens: s.tokens,
      grants: s.grants,
      approvals: s.approvals,
      accessToken: async () => null,
      socket: () => {
        const x = fakeSocket();
        s.sockets.push(x);
        return x;
      },
      sleep: async () => {},
    });
    again.start();
    expect(s.sockets).toHaveLength(3);
  });

  test("a keep-alive goes out while connected", async () => {
    const s = setup();
    const fast = createCompanion({
      registry: s.registry,
      tokens: s.tokens,
      grants: s.grants,
      approvals: s.approvals,
      accessToken: async () => "t",
      fetcher: (async () => Response.json({ device: { id: "d" }, credential: "zdv_x" })) as never,
      socket: () => {
        const x = fakeSocket();
        s.sockets.push(x);
        return x;
      },
      pingMs: 10,
      sleep: async () => {},
    });
    await fast.enable(s.remote.id);
    s.sockets[0]!.open();
    await Bun.sleep(35);
    expect(s.sockets[0]!.sent.filter((x) => x === "ping").length).toBeGreaterThanOrEqual(2);
    fast.stop();
  });
});
