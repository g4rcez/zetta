import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AddServerResult } from "../shared/launcher-rpc";
import {
  fake,
  installElectrobunFake,
  type FakeBrowserWindow,
  type FakeRpc,
  type FakeTray,
} from "../test-support/electrobun-fake";
import type { ServerEntry } from "./registry";
import { acquireInstanceLock, type InstanceLock } from "./single-instance";

/**
 * The app's entry point (`index.ts`) run for real: the real server list file, the real single-instance lock, the real discovery asking real
 * HTTP servers, and the real windows and tray, on top of a fake Electrobun (see test-support). Nothing here opens a window on the desktop.
 */
installElectrobunFake();

const LAUNCHER = "views://launcher/index.html";

type Requests = {
  listServers: (params: Record<string, never>) => ServerEntry[];
  addServer: (params: { address: string }) => Promise<AddServerResult>;
  openServer: (params: { id: string }) => boolean;
  removeServer: (params: { id: string }) => boolean;
};

const entry = (id: string, name: string, lastOpenedAt: string | null = null): ServerEntry => ({
  id,
  name,
  kind: "remote",
  webOrigin: `https://${id}.example.invalid`,
  apiOrigin: `https://${id}.example.invalid`,
  lastOpenedAt,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const launcherWindows = () => fake.windows.filter((window) => window.options.url === LAUNCHER);
const serverWindows = () => fake.windows.filter((window) => window.options.url === null);
const labels = (tray: FakeTray) => tray.menu.map((item) => item.label);

let scenario = 0;
const held: InstanceLock[] = [];
const stoppers: (() => void)[] = [];
const cleanups: (() => void)[] = [];
let exit: ReturnType<typeof spyOn>;
let log: ReturnType<typeof spyOn>;

beforeEach(() => {
  // These tests are about the launcher, the list and the windows; the server the app runs on this computer has its own tests.
  process.env.ZETTA_DESKTOP_LOCAL = "off";
  fake.reset();
  log = spyOn(console, "log").mockImplementation(() => {});
  // A second launch ends the process: here it throws, so the entry point stops where it would have.
  exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
});

afterEach(() => {
  fake.events.emit("before-quit"); // the app releases its lock the way it does when it quits
  for (const lock of held.splice(0)) lock.release();
  for (const stop of stoppers.splice(0)) stop();
  for (const done of cleanups.splice(0).reverse()) done();
  exit.mockRestore();
  log.mockRestore();
});

/** A user-data folder, with the server list the test wants saved in it (a string is written as it is). */
function prepare(options: { servers?: ServerEntry[] | string; platform?: NodeJS.Platform } = {}) {
  const userData = mkdtempSync(join(tmpdir(), "zetta-desktop-app-"));
  cleanups.push(() => rmSync(userData, { recursive: true, force: true }));
  fake.userData = userData;
  if (options.servers !== undefined)
    writeFileSync(
      join(userData, "servers.json"),
      typeof options.servers === "string"
        ? options.servers
        : JSON.stringify({ version: 1, servers: options.servers }),
    );
  if (options.platform) {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: options.platform });
    cleanups.push(() => Object.defineProperty(process, "platform", original));
  }
  return { userData };
}

/** Starts the app: every start is a fresh copy of `index.ts`, as a fresh launch would be. */
const start = () => import(`./index.ts?scenario=${++scenario}`);

async function boot(options: Parameters<typeof prepare>[0] = {}) {
  const { userData } = prepare(options);
  await start();
  const rpc = fake.rpcs[0] as FakeRpc;
  return {
    userData,
    rpc,
    requests: rpc.handlers.requests as unknown as Requests,
    tray: fake.trays[0] as FakeTray,
    saved: () =>
      (
        JSON.parse(readFileSync(join(userData, "servers.json"), "utf8")) as {
          servers: ServerEntry[];
        }
      ).servers,
  };
}

/** A pretend Zetta server on this computer: it answers `/api/meta` the way the real one does. */
function zettaServer(meta?: (origin: string) => unknown) {
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request): Response {
      const origin: string = `http://127.0.0.1:${server.port}`;
      if (new URL(request.url).pathname !== "/api/meta")
        return new Response("not found", { status: 404 });
      return Response.json(
        meta ? meta(origin) : { name: "zetta", protocol: 1, webOrigin: origin, apiOrigin: origin },
      );
    },
  });
  stoppers.push(() => void server.stop(true));
  return { origin: `http://127.0.0.1:${server.port}`, address: `127.0.0.1:${server.port}` };
}

describe("starting the app", () => {
  test("with no server yet it shows the launcher, and the tray offers the launcher and Quit", async () => {
    const { tray } = await boot();
    expect(fake.windows).toHaveLength(1);
    expect(launcherWindows()).toHaveLength(1);
    expect(fake.trays).toHaveLength(1);
    expect(labels(tray)).toEqual(["Servers…", undefined, "Quit Zetta"]);
  });

  test("with one known server it opens that server and not the launcher", async () => {
    const { saved } = await boot({ servers: [entry("team", "Team")] });
    expect(launcherWindows()).toHaveLength(0);
    expect(serverWindows()).toHaveLength(1);
    expect(fake.windows[0]!.options.title).toBe("Team");
    expect(fake.views[0]!.options.url).toBe("https://team.example.invalid/");
    expect(saved()[0]!.lastOpenedAt).not.toBeNull();
  });

  test("with several servers it opens the one used last, only", async () => {
    await boot({
      servers: [
        entry("old", "Old", "2026-11-01T10:00:00.000Z"),
        entry("recent", "Recent", "2026-11-10T10:00:00.000Z"),
        entry("never", "Never"),
      ],
    });
    expect(serverWindows().map((window) => window.options.title)).toEqual(["Recent"]);
    expect(launcherWindows()).toHaveLength(0);
  });

  test("with several servers and none used yet it asks which one", async () => {
    await boot({ servers: [entry("a", "A"), entry("b", "B")] });
    expect(serverWindows()).toHaveLength(0);
    expect(launcherWindows()).toHaveLength(1);
  });

  test("the tray lists the servers it knows", async () => {
    const { tray } = await boot({ servers: [entry("a", "A"), entry("b", "B")] });
    expect(labels(tray)).toEqual(["A", "B", undefined, "Servers…", undefined, "Quit Zetta"]);
  });

  test("a server list that cannot be read is set aside, not overwritten, and the app still starts", async () => {
    const { userData } = await boot({ servers: "{ this is not json" });
    expect(launcherWindows()).toHaveLength(1);
    expect(readdirSync(userData).some((name) => name.startsWith("servers.json.corrupt-"))).toBe(
      true,
    );
  });

  test("on macOS the standard shortcuts have an application menu", async () => {
    await boot({ platform: "darwin" });
    const menu = fake.appMenu as { label: string; submenu: { role?: string }[] }[];
    expect(menu.map((item) => item.label)).toEqual(["Zetta", "Edit", "View", "Window"]);
    const roles = (label: string) =>
      menu.find((item) => item.label === label)!.submenu.map((item) => item.role);
    expect(roles("Zetta")).toContain("quit");
    expect(roles("Edit")).toEqual(
      expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll"]),
    );
  });

  test("elsewhere it sets no application menu", async () => {
    await boot({ platform: "linux" });
    expect(fake.appMenu).toBeUndefined();
  });

  test("outside the development channel it does not look for the web dev server", async () => {
    const probes: string[] = [];
    const probe = spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      probes.push(String(input));
      throw new Error("no");
    }) as never);
    try {
      await boot({ servers: [entry("team", "Team")] });
    } finally {
      probe.mockRestore();
    }
    expect(probes).toEqual([]);
  });

  describe("in the development channel the repository's web dev server is a server too", () => {
    /** Answers the liveness probe for the origins in `up` and fails for every other address. */
    async function bootDev(up: string[]) {
      fake.channel = "dev";
      const probes: string[] = [];
      const probe = spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
        probes.push(String(input));
        if (up.includes(String(input))) return new Response(null);
        throw new Error("down");
      }) as never);
      try {
        return { app: await boot(), probes };
      } finally {
        probe.mockRestore();
      }
    }

    test("it is added as `Dev server` and opened at once when it answers over https", async () => {
      const { app, probes } = await bootDev(["https://localhost:3000"]);
      expect(probes).toEqual(["https://localhost:3000"]);
      expect(app.saved()).toMatchObject([
        {
          name: "Dev server",
          kind: "dev",
          webOrigin: "https://localhost:3000",
          apiOrigin: "https://localhost:3000",
        },
      ]);
      expect(serverWindows()).toHaveLength(1);
      expect(fake.views[0]!.options.url).toBe("https://localhost:3000/");
    });

    test("it falls back to http when https does not answer", async () => {
      const { app, probes } = await bootDev(["http://localhost:3000"]);
      expect(probes).toEqual(["https://localhost:3000", "http://localhost:3000"]);
      expect(app.saved()[0]!.webOrigin).toBe("http://localhost:3000");
    });

    test("when it is not running nothing is added and the app still starts", async () => {
      const { app, probes } = await bootDev([]);
      expect(probes).toEqual(["https://localhost:3000", "http://localhost:3000"]);
      expect(app.requests.listServers({})).toEqual([]);
      expect(launcherWindows()).toHaveLength(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Web dev server not running"));
    });
  });
});

describe("what the launcher can ask for", () => {
  test("answers every request the launcher page makes, and the page makes every request it answers", async () => {
    const { rpc } = await boot();
    const page = readFileSync(join(import.meta.dir, "..", "launcher", "index.ts"), "utf8");
    const asked = [...new Set([...page.matchAll(/rpc\.request\.(\w+)/g)].map((m) => m[1]!))];
    expect(asked.sort()).toEqual(Object.keys(rpc.handlers.requests).sort());
  });

  test("the list of servers", async () => {
    const { requests } = await boot({ servers: [entry("a", "A"), entry("b", "B")] });
    expect(requests.listServers({}).map((server) => server.name)).toEqual(["A", "B"]);
  });

  test("adding a server that answers: it is saved, shown in the tray and told to the launcher", async () => {
    const { requests, saved, tray, rpc } = await boot();
    const zetta = zettaServer();

    const result = await requests.addServer({ address: zetta.address });
    expect(result.status).toBe("added");
    if (result.status !== "added") throw new Error("not added");
    expect(result.server).toMatchObject({
      kind: "remote",
      name: zetta.address,
      webOrigin: zetta.origin,
      apiOrigin: zetta.origin,
    });
    expect(result.sharesCookiesWith).toEqual([]);

    expect(saved().map((server) => server.webOrigin)).toEqual([zetta.origin]);
    expect(labels(tray)).toEqual([zetta.address, undefined, "Servers…", undefined, "Quit Zetta"]);
    const told = rpc.sent.filter((message) => message.name === "serversChanged").at(-1);
    expect((told!.args[0] as ServerEntry[]).map((server) => server.webOrigin)).toEqual([
      zetta.origin,
    ]);
  });

  test("adding the same server twice keeps one entry", async () => {
    const { requests, saved } = await boot();
    const zetta = zettaServer();
    await requests.addServer({ address: zetta.address });
    await requests.addServer({ address: zetta.address });
    expect(saved()).toHaveLength(1);
  });

  test("a second server on the same host is added with a warning that signing in to one signs out the other", async () => {
    const { requests } = await boot();
    const first = zettaServer();
    const second = zettaServer();
    await requests.addServer({ address: first.address });
    const result = await requests.addServer({ address: second.address });
    if (result.status !== "added") throw new Error("not added");
    expect(result.sharesCookiesWith).toEqual([first.address]);
  });

  test("a web UI served on its own is found through the API it names", async () => {
    const { requests, saved } = await boot();
    const links = { web: "", api: "" };
    const api = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) =>
        new URL(request.url).pathname === "/api/meta"
          ? Response.json({
              name: "zetta",
              protocol: 1,
              webOrigin: links.web,
              apiOrigin: links.api,
            })
          : new Response("not found", { status: 404 }),
    });
    const web = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) =>
        new URL(request.url).pathname === "/.well-known/zetta.json"
          ? Response.json({ name: "zetta", protocol: 1, apiOrigin: links.api })
          : new Response("not found", { status: 404 }),
    });
    stoppers.push(
      () => void api.stop(true),
      () => void web.stop(true),
    );
    links.api = `http://127.0.0.1:${api.port}`;
    links.web = `http://127.0.0.1:${web.port}`;

    const result = await requests.addServer({ address: `127.0.0.1:${web.port}` });
    expect(result.status).toBe("added");
    expect(saved()).toMatchObject([{ webOrigin: links.web, apiOrigin: links.api }]);
  });

  describe("an address that cannot be added says why and changes nothing", () => {
    const check = async (
      address: string,
      status: AddServerResult["status"],
      setup?: () => string,
    ) => {
      const { requests, saved, tray, rpc } = await boot();
      const toldAtStart = rpc.sent.length; // the app tells the launcher the (empty) list once when it starts
      const target = setup ? setup() : address;
      const result = await requests.addServer({ address: target });
      expect(result.status).toBe(status);
      expect(requests.listServers({})).toEqual([]);
      expect(labels(tray)).toEqual(["Servers…", undefined, "Quit Zetta"]);
      expect(rpc.sent).toHaveLength(toldAtStart);
      expect(() => saved()).toThrow(); // nothing was ever written
    };

    test("nothing typed", () => check("   ", "invalid-address"));
    test("not a web address", () => check("javascript:alert(1)", "invalid-address"));
    test("nobody answers", () =>
      check("", "unreachable", () => {
        const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
        const port = probe.port;
        void probe.stop(true);
        return `127.0.0.1:${port}`;
      }));
    test("something answers that is not Zetta", () =>
      check("", "not-zetta", () => zettaServer(() => ({ hello: "world" })).address));
    test("a server that needs a newer app", () =>
      check(
        "",
        "newer-protocol",
        () =>
          zettaServer((origin) => ({
            name: "zetta",
            protocol: 99,
            webOrigin: origin,
            apiOrigin: origin,
          })).address,
      ));
    test("a server that names another address than the one typed", () =>
      check(
        "",
        "not-zetta",
        () =>
          zettaServer(() => ({
            name: "zetta",
            protocol: 1,
            webOrigin: "https://elsewhere.example.invalid",
            apiOrigin: "https://elsewhere.example.invalid",
          })).address,
      ));
  });

  test("a server is still added while the launcher window is closed", async () => {
    const { requests, saved } = await boot();
    fake.sendFails = true;
    const zetta = zettaServer();
    const result = await requests.addServer({ address: zetta.address });
    expect(result.status).toBe("added");
    expect(saved()).toHaveLength(1);
  });

  test("opening a server brings up its window; an unknown one opens nothing", async () => {
    const { requests } = await boot({ servers: [entry("a", "A"), entry("b", "B")] });
    expect(requests.openServer({ id: "b" })).toBe(true);
    expect(serverWindows().map((window) => window.options.title)).toEqual(["B"]);
    expect(requests.openServer({ id: "nope" })).toBe(false);
    expect(serverWindows()).toHaveLength(1);
  });

  test("removing a server closes its window, drops it from the file and the tray, and tells the launcher", async () => {
    const { requests, saved, tray, rpc } = await boot({
      servers: [entry("a", "A"), entry("b", "B")],
    });
    requests.openServer({ id: "a" });
    const window = serverWindows()[0] as FakeBrowserWindow;
    const told = () => rpc.sent.filter((message) => message.name === "serversChanged");
    const toldBefore = told().length;

    expect(requests.removeServer({ id: "a" })).toBe(true);
    expect(window.closed).toBe(true);
    expect(saved().map((server) => server.id)).toEqual(["b"]);
    expect(labels(tray)).toEqual(["B", undefined, "Servers…", undefined, "Quit Zetta"]);
    expect(told()).toHaveLength(toldBefore + 1);
    expect((told().at(-1)!.args[0] as ServerEntry[]).map((server) => server.id)).toEqual(["b"]);

    // A server that is already gone: false, and nobody is told again.
    expect(requests.removeServer({ id: "a" })).toBe(false);
    expect(told()).toHaveLength(toldBefore + 1);
  });
});

describe("the tray, quitting and launching twice", () => {
  test("the tray opens the launcher and a server", async () => {
    const { tray } = await boot({ servers: [entry("team", "Team")] });
    const server = serverWindows()[0] as FakeBrowserWindow;
    fake.userClose(server); // hidden, the app keeps running in the tray
    expect(server.hidden).toBe(true);

    tray.click("server", { id: "team" });
    expect(server.hidden).toBe(false);
    tray.click("launcher");
    expect(launcherWindows()).toHaveLength(1);
  });

  test("Quit in the tray quits, lets the windows really close and frees the app for the next launch", async () => {
    const { tray, userData } = await boot({ servers: [entry("team", "Team")] });
    const window = serverWindows()[0] as FakeBrowserWindow;

    tray.click("quit");
    expect(fake.quits).toBe(1);
    fake.userClose(window);
    expect(window.closed).toBe(true);

    const next = await acquireInstanceLock(join(userData, "run"), [], () => {});
    expect(next).not.toBeNull();
    held.push(next!);
  });

  test("quitting from the application menu does the same", async () => {
    const { userData } = await boot({ servers: [entry("team", "Team")] });
    const window = serverWindows()[0] as FakeBrowserWindow;

    fake.events.emit("before-quit");
    fake.userClose(window);
    expect(window.closed).toBe(true);
    const next = await acquireInstanceLock(join(userData, "run"), [], () => {});
    expect(next).not.toBeNull();
    held.push(next!);
  });

  test("while it runs, closing a window only hides it", async () => {
    await boot({ servers: [entry("team", "Team")] });
    const window = serverWindows()[0] as FakeBrowserWindow;
    fake.userClose(window);
    expect(window.hidden).toBe(true);
    expect(window.closed).toBe(false);
  });

  test("a second launch exits and leaves the first one running", async () => {
    const { userData } = prepare();
    const seen: string[][] = [];
    const first = await acquireInstanceLock(join(userData, "run"), [], (argv) => seen.push(argv));
    held.push(first!);

    await expect(start()).rejects.toThrow("exit:0");
    await wait(30);
    expect(fake.windows).toHaveLength(0);
    expect(fake.trays).toHaveLength(0);
    expect(seen).toEqual([process.argv.slice(2)]);
  });

  test("a second launch brings the running app forward", async () => {
    const { userData } = await boot({ servers: [entry("team", "Team")] });
    const window = serverWindows()[0] as FakeBrowserWindow;
    fake.userClose(window);
    expect(window.hidden).toBe(true);

    const second = await acquireInstanceLock(join(userData, "run"), ["zetta://open"], () => {});
    expect(second).toBeNull();
    await wait(30);
    expect(window.hidden).toBe(false);
  });

  test("clicking the app's icon again (reopen) brings a window back", async () => {
    await boot({ servers: [entry("team", "Team")] });
    const window = serverWindows()[0] as FakeBrowserWindow;
    fake.userClose(window);
    fake.events.emit("reopen");
    expect(window.hidden).toBe(false);
  });

  test("reopen with only the launcher brings the launcher back", async () => {
    await boot();
    const launcher = launcherWindows()[0] as FakeBrowserWindow;
    fake.userClose(launcher);
    expect(launcher.hidden).toBe(true);
    fake.events.emit("reopen");
    expect(launcher.hidden).toBe(false);
  });
});
