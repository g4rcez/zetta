import { beforeEach, describe, expect, test } from "bun:test";

import { fake, installElectrobunFake, type FakeTray } from "../test-support/electrobun-fake";
import type { ServerEntry } from "./registry";

installElectrobunFake();
const { createTray } = await import("./tray");

const server = (id: string, name: string): ServerEntry => ({
  id,
  name,
  kind: "remote",
  webOrigin: `https://${id}.example.invalid`,
  apiOrigin: `https://${id}.example.invalid`,
  lastOpenedAt: null,
});

beforeEach(() => fake.reset());

function setup() {
  const calls: string[] = [];
  const tray = createTray({
    openLauncher: () => calls.push("launcher"),
    openServer: (id) => calls.push(`server:${id}`),
    quit: () => calls.push("quit"),
    togglePause: () => calls.push("pause"),
  });
  return { calls, tray, fakeTray: fake.trays[0] as FakeTray };
}

describe("the tray icon", () => {
  test("is created once, from the app's own icon", () => {
    setup();
    expect(fake.trays).toHaveLength(1);
    expect(fake.trays[0]!.options).toMatchObject({
      image: "views://assets/tray.png",
      template: false,
      width: 18,
      height: 18,
    });
  });

  test("lists the servers, then the launcher and Quit", () => {
    const { tray, fakeTray } = setup();
    tray.setServers([server("a", "Team"), server("b", "Home")]);
    expect(fakeTray.menu).toEqual([
      { type: "normal", label: "Team", action: "server", data: { id: "a" } },
      { type: "normal", label: "Home", action: "server", data: { id: "b" } },
      { type: "divider" },
      { type: "normal", label: "Servers…", action: "launcher" },
      { type: "divider" },
      { type: "normal", label: "Quit Zetta", action: "quit" },
    ]);
  });

  test("with no server it still offers the launcher and Quit, without a stray divider on top", () => {
    const { tray, fakeTray } = setup();
    tray.setServers([]);
    expect(fakeTray.menu).toEqual([
      { type: "normal", label: "Servers…", action: "launcher" },
      { type: "divider" },
      { type: "normal", label: "Quit Zetta", action: "quit" },
    ]);
  });

  test("the menu follows the list when it changes", () => {
    const { tray, fakeTray } = setup();
    tray.setServers([server("a", "Team")]);
    tray.setServers([]);
    expect(fakeTray.menu.map((item) => item.label)).toEqual(["Servers…", undefined, "Quit Zetta"]);
    expect(fakeTray.menu.some((item) => item.label === "Team")).toBe(false);
  });
});

describe("sharing this computer", () => {
  test("offers pause only while something is shared, and says what the next press does", () => {
    const { tray, fakeTray, calls } = setup();
    tray.setServers([]);
    expect(fakeTray.menu.some((item) => item.action === "pause")).toBe(false);
    tray.setSharing({ active: true, paused: false });
    expect(fakeTray.menu.find((item) => item.action === "pause")?.label).toBe(
      "Pause sharing this computer",
    );
    tray.setSharing({ active: true, paused: true });
    expect(fakeTray.menu.find((item) => item.action === "pause")?.label).toBe(
      "Resume sharing this computer",
    );
    fakeTray.click("pause");
    expect(calls).toEqual(["pause"]);
    tray.setSharing({ active: false, paused: false });
    expect(fakeTray.menu.some((item) => item.action === "pause")).toBe(false);
  });
});

describe("choosing a tray entry", () => {
  test("a server opens that server", () => {
    const { calls, fakeTray } = setup();
    fakeTray.click("server", { id: "a" });
    expect(calls).toEqual(["server:a"]);
  });

  test("the launcher entry opens the launcher", () => {
    const { calls, fakeTray } = setup();
    fakeTray.click("launcher");
    expect(calls).toEqual(["launcher"]);
  });

  test("Quit quits", () => {
    const { calls, fakeTray } = setup();
    fakeTray.click("quit");
    expect(calls).toEqual(["quit"]);
  });

  test("a click with nothing usable in it does nothing", () => {
    const { calls, fakeTray } = setup();
    fakeTray.click("server"); // no id
    fakeTray.click("server", {}); // empty data
    fakeTray.click("something-else");
    fakeTray.emit("tray-clicked", {}); // no action at all
    expect(calls).toEqual([]);
  });
});
