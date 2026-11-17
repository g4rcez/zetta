import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fake,
  FakeBrowserView,
  installElectrobunFake,
  type FakeBrowserWindow,
} from "../test-support/electrobun-fake";

installElectrobunFake();
const { createWindows } = await import("./windows");
const { createRegistry } = await import("./registry");

const WEB = "https://zetta.example.invalid";
const API = "https://api.example.invalid";

let dir = "";
beforeEach(() => {
  fake.reset();
  dir = mkdtempSync(join(tmpdir(), "zetta-windows-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup() {
  const registry = createRegistry(join(dir, "servers.json"));
  const server = registry.add({ name: "Team", kind: "remote", webOrigin: WEB, apiOrigin: API });
  const rpc = FakeBrowserView.defineRPC({ handlers: { requests: {}, messages: {} } });
  const opened: string[] = [];
  const windows = createWindows({
    registry,
    launcherRpc: rpc as never,
    onServerOpened: (entry) => opened.push(entry.id),
  });
  return { registry, server, rpc, opened, windows };
}

const lastWindow = () => fake.windows.at(-1) as FakeBrowserWindow;
const lastView = () => fake.views.at(-1) as FakeBrowserView;
/** The event Electrobun raises for a navigation: the url is in `data.detail`, as a string or as `{ url }`. */
const navigation = (url: string) => ({ data: { detail: url } });

describe("the launcher window", () => {
  test("opens once, with the launcher page and its channel, and is brought forward after that", () => {
    const { windows, rpc } = setup();
    const first = windows.showLauncher() as unknown as FakeBrowserWindow;
    expect(first.options.title).toBe("Zetta");
    expect(first.options.url).toBe("views://launcher/index.html");
    expect(first.options.rpc).toBe(rpc);

    const again = windows.showLauncher() as unknown as FakeBrowserWindow;
    expect(again).toBe(first);
    expect(fake.windows).toHaveLength(1);
    expect(first.shown).toBe(1);
  });

  test("closing it hides it and the app keeps running", () => {
    const { windows } = setup();
    const launcher = windows.showLauncher() as unknown as FakeBrowserWindow;
    fake.userClose(launcher);
    expect(launcher.hidden).toBe(true);
    expect(launcher.closed).toBe(false);

    const back = windows.showLauncher() as unknown as FakeBrowserWindow;
    expect(back).toBe(launcher);
    expect(launcher.hidden).toBe(false);
  });

  test("once the app is quitting, closing really closes it, and the next request makes a new one", () => {
    const { windows } = setup();
    const launcher = windows.showLauncher() as unknown as FakeBrowserWindow;
    windows.beginQuit();
    fake.userClose(launcher);
    expect(launcher.closed).toBe(true);

    const next = windows.showLauncher() as unknown as FakeBrowserWindow;
    expect(next).not.toBe(launcher);
    expect(fake.windows).toHaveLength(2);
  });
});

describe("a server window", () => {
  test("a server that is not in the list opens nothing", () => {
    const { windows } = setup();
    expect(windows.openServer("not-a-server")).toBe(false);
    expect(fake.windows).toHaveLength(0);
  });

  test("shows the server's own web UI in a sandboxed window with no channel to the app", () => {
    const { windows, server } = setup();
    expect(windows.openServer(server.id)).toBe(true);

    const window = lastWindow();
    expect(window.options.title).toBe("Team");
    expect(window.options.url).toBeNull();
    expect(window.options.sandbox).toBe(true);
    expect(window.options.renderer).toBe("cef");
    expect(window.options.rpc).toBeUndefined();
    expect(window.options.allowedProtocols).toEqual({ views: false, appData: false });
    expect(fake.removedViewIds).toEqual([window.webviewId]);

    const view = lastView();
    expect(view.options.url).toBe(`${WEB}/`);
    expect(view.options.windowId).toBe(window.id);
    expect(view.options.sandbox).toBe(true);
    expect(view.options.renderer).toBe("cef");
    expect(view.options.rpc).toBeUndefined();
    expect(view.options.allowedProtocols).toEqual({ views: false, appData: false });
  });

  test("remembers that the server was opened", () => {
    const { windows, server, registry, opened } = setup();
    expect(registry.get(server.id)?.lastOpenedAt).toBeNull();
    windows.openServer(server.id);
    expect(registry.get(server.id)?.lastOpenedAt).not.toBeNull();
    expect(opened).toEqual([server.id]);
  });

  test("asking again brings the same window forward instead of opening another", () => {
    const { windows, server } = setup();
    windows.openServer(server.id);
    const window = lastWindow();
    window.hide();
    windows.openServer(server.id);
    expect(fake.windows).toHaveLength(1);
    expect(window.hidden).toBe(false);
  });

  test("each server gets its own window", () => {
    const { windows, server, registry } = setup();
    const other = registry.add({
      name: "Other",
      kind: "remote",
      webOrigin: "https://other.example.invalid",
      apiOrigin: "https://other.example.invalid",
    });
    windows.openServer(server.id);
    windows.openServer(other.id);
    expect(fake.windows.map((w) => w.options.title)).toEqual(["Team", "Other"]);
    expect(fake.views.map((v) => v.options.url)).toEqual([
      `${WEB}/`,
      "https://other.example.invalid/",
    ]);
  });

  test("a path only applies to a window that has to be created", () => {
    const { windows, server } = setup();
    windows.openServer(server.id, "/tasks?status=open#top");
    expect(lastView().options.url).toBe(`${WEB}/tasks?status=open#top`);
    windows.openServer(server.id, "/chat");
    expect(fake.views).toHaveLength(1);
  });

  test("closing the window hides it; the server stays one click away", () => {
    const { windows, server } = setup();
    windows.openServer(server.id);
    const window = lastWindow();
    fake.userClose(window);
    expect(window.hidden).toBe(true);
    expect(window.closed).toBe(false);

    windows.openServer(server.id);
    expect(fake.windows).toHaveLength(1);
    expect(window.hidden).toBe(false);
  });

  test("when the app quits, a closed window is gone and the server opens a new one", () => {
    const { windows, server } = setup();
    windows.openServer(server.id);
    const window = lastWindow();
    windows.beginQuit();
    fake.userClose(window);
    expect(window.closed).toBe(true);

    windows.openServer(server.id);
    expect(fake.windows).toHaveLength(2);
  });

  test("removing a server closes its windows", () => {
    const { windows, server } = setup();
    windows.openServer(server.id);
    const window = lastWindow();
    windows.closeServer(server.id);
    expect(window.closed).toBe(true);

    // Nothing is left to bring forward, so the next request opens a fresh one.
    windows.openServer(server.id);
    expect(fake.windows).toHaveLength(2);
  });

  test("closing a server that has no window does nothing", () => {
    const { windows, server } = setup();
    expect(() => windows.closeServer(server.id)).not.toThrow();
  });
});

describe("bringing the app forward", () => {
  test("shows the most recent server window when there is one", () => {
    const { windows, server, registry } = setup();
    const other = registry.add({
      name: "Other",
      kind: "remote",
      webOrigin: "https://other.example.invalid",
      apiOrigin: "https://other.example.invalid",
    });
    windows.openServer(server.id);
    windows.openServer(other.id);
    const [first, second] = fake.windows;
    first!.hide();
    second!.hide();

    windows.focusAny();
    expect(second!.hidden).toBe(false);
    expect(first!.hidden).toBe(true);
  });

  test("opens the launcher when no server window exists", () => {
    const { windows } = setup();
    windows.focusAny();
    expect(fake.windows).toHaveLength(1);
    expect(lastWindow().options.url).toBe("views://launcher/index.html");
  });
});

describe("links inside a server window", () => {
  function open() {
    const ctx = setup();
    ctx.windows.openServer(ctx.server.id);
    return { ...ctx, view: lastView() };
  }

  test("the server's own pages and its API stay inside", () => {
    const { view } = open();
    view.emit("did-navigate", navigation(`${WEB}/chat/1?x=2#y`));
    view.emit("did-navigate", navigation(`${API}/api/artifacts/1`));
    view.emit("did-navigate", navigation("about:blank"));
    expect(fake.openedExternal).toEqual([]);
    expect(view.executed).toEqual([]);
  });

  test("a navigation event may carry the address as an object", () => {
    const { view } = open();
    view.emit("did-navigate", { data: { detail: { url: "https://example.org/" } } });
    expect(fake.openedExternal).toEqual(["https://example.org/"]);
  });

  test("another site opens in the system browser and the window goes back to where it was", () => {
    const { view } = open();
    view.emit("did-navigate", navigation("https://example.org/page"));
    expect(fake.openedExternal).toEqual(["https://example.org/page"]);
    expect(view.executed).toEqual(["history.back()"]);
  });

  test("a look-alike address and another scheme of the same host count as another site", () => {
    const { view } = open();
    view.emit("did-navigate", navigation("https://zetta.example.invalid.evil.invalid/"));
    view.emit("did-navigate", navigation("http://zetta.example.invalid/"));
    expect(fake.openedExternal).toEqual([
      "https://zetta.example.invalid.evil.invalid/",
      "http://zetta.example.invalid/",
    ]);
  });

  test("an address that is not a website opens nowhere", () => {
    const { view } = open();
    for (const target of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hi",
      "views://launcher/index.html",
      "not a url",
    ])
      view.emit("did-navigate", navigation(target));
    expect(fake.openedExternal).toEqual([]);
    expect(view.executed).toHaveLength(5);
  });

  test("a popup to another site opens in the system browser and no window", () => {
    const { view } = open();
    fake.events.emit(`new-window-open-${view.id}`, navigation("https://example.org/"));
    expect(fake.openedExternal).toEqual(["https://example.org/"]);
    expect(fake.windows).toHaveLength(1);
  });

  test("a popup to the server's own page gets its own window at the same path", () => {
    const { view } = open();
    fake.events.emit(`new-window-open-${view.id}`, navigation(`${WEB}/computer/7?tab=a#live`));
    expect(fake.windows).toHaveLength(2);
    expect(lastView().options.url).toBe(`${WEB}/computer/7?tab=a#live`);
    expect(fake.openedExternal).toEqual([]);
  });

  test("an empty popup, or one to an address that is not a website, does nothing", () => {
    const { view } = open();
    fake.events.emit(`new-window-open-${view.id}`, navigation("about:blank"));
    fake.events.emit(`new-window-open-${view.id}`, navigation("javascript:alert(1)"));
    fake.events.emit(`new-window-open-${view.id}`, {});
    expect(fake.windows).toHaveLength(1);
    expect(fake.openedExternal).toEqual([]);
  });
});
