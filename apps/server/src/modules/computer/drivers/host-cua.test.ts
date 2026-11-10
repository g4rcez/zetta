import { describe, expect, test } from "bun:test";

import { createHostCuaDriver, elementsText, frontWindow } from "./host-cua";

// Shapes taken from cua-driver 0.36 on macOS (`cua-driver call list_windows` / `get_window_state` / `check_permissions`).
const WINDOWS = {
  current_space_id: 1,
  windows: [
    {
      app_name: "Notes",
      title: "Notes",
      pid: 20,
      window_id: 2,
      layer: 0,
      is_on_screen: false,
      on_current_space: true,
      z_index: 114,
      bounds: { width: 1000, height: 660 },
    },
    {
      app_name: "Safari",
      title: "Example",
      pid: 10,
      window_id: 1,
      layer: 0,
      is_on_screen: true,
      on_current_space: true,
      z_index: 115,
      bounds: { width: 1200, height: 800 },
    },
    {
      app_name: "Dock",
      title: "",
      pid: 5,
      window_id: 9,
      layer: 20,
      is_on_screen: true,
      z_index: 200,
    },
  ],
};
const ELEMENTS = [
  {
    element_index: 0,
    element_token: "s1:0",
    role: "AXWindow",
    label: "Example",
    actions: ["AXRaise"],
  },
  { element_index: 1, element_token: "s1:1", role: "AXStaticText", value: "Welcome to the page" },
  {
    element_index: 2,
    element_token: "s1:2",
    role: "AXButton",
    label: "Sign up",
    actions: ["AXPress"],
  },
  { element_index: 3, element_token: "s1:3", role: "AXTextField", label: "Search", value: "" },
];

function fake() {
  const calls: [string, Record<string, unknown>][] = [];
  const opened: string[] = [];
  const driver = createHostCuaDriver(
    async (tool, args) => {
      calls.push([tool, args]);
      const structured =
        tool === "list_windows"
          ? WINDOWS
          : tool === "check_permissions"
            ? { accessibility: true, screen_recording: true }
            : tool === "get_window_state"
              ? args.include_accessibility_tree === false
                ? { screenshot_png_b64: "iVBOR" }
                : { window_title: "Example", elements: ELEMENTS }
              : { ok: true };
      return { text: JSON.stringify(structured), isError: false, structured };
    },
    async (url) => void opened.push(url),
  );
  return { driver, calls, opened };
}

describe("this computer through cua-driver", () => {
  test("the bot works in the frontmost window on screen, never in hidden windows or the Dock", () => {
    expect(frontWindow(WINDOWS.windows)?.app_name).toBe("Safari");
    expect(frontWindow([])).toBeUndefined();
  });

  test("elements read as text; buttons and fields are numbered", () => {
    const { lines, items } = elementsText(ELEMENTS);
    expect(lines).toEqual([
      'window "Example"',
      "Welcome to the page",
      '[1] button "Sign up"',
      '[2] textfield "Search"',
    ]);
    expect(items.get(1)).toBe("s1:2");
  });

  test("read, then click by number, keys, typing and scrolling go to that window's process", async () => {
    const { driver, calls } = fake();
    await driver.ready();
    const page = await driver.read({});
    expect(page).toMatchObject({ kind: "page", title: "Safari: Example" });
    await driver.act({ type: "click_element", n: 1 });
    await driver.act({ type: "key", key: "command+l" });
    await driver.act({ type: "key", key: "Return" });
    await driver.act({ type: "type", text: "hello" });
    await driver.act({ type: "scroll", direction: "down" });
    const acts = calls.filter(
      ([t]) => !["list_windows", "check_permissions", "get_window_state"].includes(t),
    );
    expect(acts).toEqual([
      ["click", { pid: 10, window_id: 1, element_token: "s1:2" }],
      ["hotkey", { pid: 10, window_id: 1, keys: ["cmd", "l"] }],
      ["press_key", { pid: 10, window_id: 1, key: "return" }],
      ["type_text", { pid: 10, window_id: 1, text: "hello" }],
      ["scroll", { pid: 10, window_id: 1, direction: "down", amount: 3 }],
    ]);
  });

  test("an address opens in the person's browser; a screenshot is the window's; passwords are refused", async () => {
    const { driver, opened } = fake();
    await driver.act({ type: "navigate", url: "https://example.com" });
    expect(opened).toEqual(["https://example.com"]);
    expect(await driver.screenshot()).toBe("iVBOR");
    expect(driver.fillCredential({} as never, async () => "x")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });

  test("a missing Accessibility grant says how to fix it", async () => {
    const d = createHostCuaDriver(
      async () => ({ text: "", isError: false, structured: { accessibility: false } }),
      async () => {},
    );
    expect(d.ready()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
