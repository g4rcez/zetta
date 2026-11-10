import { describe, expect, test } from "bun:test";

import { ComputerError } from "../service";
import {
  createHostAgentDesktopDriver,
  NEEDS_PERMISSION_DETAIL,
  permissionProblem,
  pickWindow,
  pressKey,
} from "./host-agent-desktop";

// Real output of `agent-desktop list-windows` (1.0.2, macOS) from a terminal without the Accessibility grant; names anonymized.
const noAccess = await Bun.file(
  `${import.meta.dir}/fixtures/host-list-windows-no-access.json`,
).text();

describe("host desktop (agent-desktop on this computer)", () => {
  test("without macOS Accessibility every window reads as not accessible: the driver says how to allow it", async () => {
    const driver = createHostAgentDesktopDriver(
      async () => ({ code: 0, stdout: noAccess }),
      async () => {},
    );
    const e = await driver.ready().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ComputerError);
    expect((e as ComputerError).detail).toBe(NEEDS_PERMISSION_DETAIL);
    expect(await driver.probe()).toBe(true);
  });

  test("the focused accessible window is the one read; an invisible one never is", () => {
    expect(
      pickWindow([
        { id: "a", app_name: "X", title: "x", accessible: true, visible: false, is_focused: true },
        { id: "b", app_name: "Y", title: "y", accessible: true, visible: true },
        { id: "c", app_name: "Z", title: "z", accessible: true, visible: true, is_focused: true },
      ]),
    ).toMatchObject({ id: "c" });
    expect(pickWindow([])).toBe("none");
  });

  test("keys are named the way press takes them", () => {
    expect(pressKey("ctrl+L")).toBe("ctrl+l");
    expect(pressKey("Command+c")).toBe("cmd+c");
    expect(pressKey("Return")).toBe("return");
  });

  test("a missing tool is a transport failure, not a silent success", async () => {
    const driver = createHostAgentDesktopDriver(
      async () => ({ code: 127, stdout: "" }),
      async () => {},
    );
    await expect(driver.ready()).rejects.toThrow("no envelope");
  });
});

// Real output of `agent-desktop permissions` (2.5, macOS) with Accessibility granted and Screen Recording not.
const PERMS = {
  accessibility: { state: "granted" },
  automation: { state: "unknown" },
  screen_recording: {
    state: "denied",
    suggestion:
      "Run agent-desktop permissions --guide. It opens System Settings > Privacy & Security > Screen Recording.",
  },
};
test("the permission report decides: reading works, a screenshot says exactly how to allow Screen Recording", () => {
  expect(permissionProblem(PERMS, "accessibility")).toBeUndefined();
  expect(permissionProblem(PERMS, "screen_recording")).toContain("Screen Recording");
  expect(permissionProblem({ accessibility: { state: "denied" } }, "accessibility")).toBe(
    NEEDS_PERMISSION_DETAIL,
  );
  expect(permissionProblem(undefined, "accessibility")).toBeUndefined();
});

// Real `agent-desktop snapshot` (2.5, macOS) of a native app's window (no web page in it); names anonymized except generic buttons.
test("a native app window is read whole: its buttons and fields are numbered for click_element", async () => {
  const { parsePage } = await import("./agent-desktop");
  const snap = JSON.parse(
    await Bun.file(`${import.meta.dir}/fixtures/host-snapshot-native-app.json`).text(),
  );
  expect(parsePage(snap.data.tree).lines).toEqual([]); // the browser reading finds no web page
  const page = parsePage(snap.data.tree, { whole: true });
  expect(page.items.size).toBeGreaterThan(5);
  expect(page.lines.some((l) => /^\[\d+\] button "Close"$/.test(l))).toBe(true);
});
