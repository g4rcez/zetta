import type { CredentialField } from "../../integrations/plugins/registry";
import type { McpCall } from "../mcp-client";
import { ComputerError } from "../service";
import { pressKey } from "./host-agent-desktop";
import type { DesktopDriver } from "./types";

/**
 * This machine's own desktop through cua-driver (macOS, checked against cua-driver 0.36): the window the bot works in is the frontmost
 * one on the current Space, read as its accessibility elements; steps go to that window's process in the background (the person's
 * mouse and focus stay theirs). Coordinates of `click` are the window screenshot's pixels, the same space `screenshot` returns.
 * Passwords are never typed here: the person signs in themselves.
 */
const CALL_MS = 30_000;
const MAX_ELEMENTS = 400;

type Win = {
  app_name?: string;
  title?: string;
  pid: number;
  window_id: number;
  layer?: number;
  is_on_screen?: boolean;
  on_current_space?: boolean;
  z_index?: number;
  bounds?: { width?: number; height?: number };
};
type Element = {
  element_index: number;
  element_token: string;
  role?: string;
  label?: string;
  value?: unknown;
  actions?: string[];
};

/** cua-driver's own windows and invisible helpers are never the bot's target. */
const SKIP_APPS = new Set(["CuaDriver", "Cua Driver", "Window Server", "Dock", "Control Center"]);

/** The window the bot works in: the frontmost normal window on the screen the person sees. */
export function frontWindow(list: Win[]): Win | undefined {
  return list
    .filter(
      (w) =>
        (w.layer ?? 0) === 0 &&
        w.is_on_screen !== false &&
        w.on_current_space !== false &&
        !SKIP_APPS.has(w.app_name ?? "") &&
        (w.bounds?.width ?? 1) > 40 &&
        (w.bounds?.height ?? 1) > 40,
    )
    .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0];
}

/** Roles a person can act on; they get a number the bot clicks with click_element. */
const ACTIONABLE =
  /^AX(Button|Link|TextField|TextArea|SearchField|CheckBox|RadioButton|PopUpButton|MenuItem|MenuButton|Tab|ComboBox|Slider|DisclosureTriangle|Cell|Row)$/;

/** The window's elements as numbered text: one line per element that says something, actionable ones numbered. */
export function elementsText(elements: Element[]) {
  const items = new Map<number, string>();
  const lines: string[] = [];
  let last = "";
  for (const e of elements) {
    const label = (e.label ?? "").trim();
    const value = typeof e.value === "string" ? e.value.trim() : "";
    const text = (label || value).replace(/\s+/g, " ").slice(0, 300);
    if (!text || text === last) continue;
    last = text;
    const role = (e.role ?? "").replace(/^AX/, "").toLowerCase();
    const actionable = ACTIONABLE.test(e.role ?? "") || (e.actions ?? []).includes("AXPress");
    if (actionable) {
      const n = items.size + 1;
      items.set(n, e.element_token);
      lines.push(
        `[${n}] ${role} "${text}"${value && value !== label ? ` = "${value.slice(0, 120)}"` : ""}`,
      );
    } else lines.push(role === "statictext" || role === "group" ? text : `${role} "${text}"`);
  }
  return { lines, items };
}

export function createHostCuaDriver(
  call: McpCall,
  /** Opens an address in the person's default browser, signed in as they are. */
  openUrl: (url: string, signal?: AbortSignal) => Promise<void>,
): DesktopDriver {
  let items = new Map<number, string>();
  let current: Win | undefined;
  const data = (r: { text: string; structured?: unknown }) => {
    if (r.structured && typeof r.structured === "object")
      return r.structured as Record<string, unknown>;
    try {
      return JSON.parse(r.text) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  async function tool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const r = await call(name, args, { signal, timeout: CALL_MS });
    if (r.isError) throw new ComputerError("UNAVAILABLE", r.text.slice(0, 300) || undefined);
    return { ...r, data: data(r) };
  }
  async function window(signal?: AbortSignal) {
    const r = await tool("list_windows", {}, signal);
    current = frontWindow((r.data.windows as Win[] | undefined) ?? []);
    return current;
  }
  const target = (w: Win) => ({ pid: w.pid, window_id: w.window_id });
  async function need(signal?: AbortSignal) {
    const w = current ?? (await window(signal));
    if (!w) throw new ComputerError("NO_ELEMENT", "No window is open on this computer.");
    return w;
  }
  return {
    async ready() {
      const p = (await tool("check_permissions", {})).data;
      if (p.accessibility === false)
        throw new ComputerError(
          "UNAVAILABLE",
          "Cua Driver needs Accessibility access. Run `cua-driver permissions grant` and allow it in System Settings.",
        );
      await window();
    },
    async probe() {
      try {
        await tool("list_windows", {});
        return true;
      } catch {
        return false;
      }
    },
    async screenshot() {
      const w = await need();
      const r = await tool("get_window_state", { ...target(w), include_accessibility_tree: false });
      const png = (r.data.screenshot_png_b64 as string | undefined) ?? r.imageBase64;
      if (!png)
        throw new ComputerError(
          "UNAVAILABLE",
          "Cua Driver needs Screen Recording access for screenshots.",
        );
      return png;
    },
    async read(o) {
      const w = await window(o.signal);
      if (!w) return { kind: "plain", text: "No windows are open." };
      const r = await tool(
        "get_window_state",
        {
          ...target(w),
          include_screenshot: false,
          tree_format: "elements",
          max_elements: MAX_ELEMENTS,
        },
        o.signal,
      );
      const page = elementsText((r.data.elements as Element[] | undefined) ?? []);
      items = page.items;
      const title = (r.data.window_title as string | undefined) || w.title || "";
      return {
        kind: "page",
        title: `${w.app_name ?? "App"}${title ? `: ${title}` : ""}`,
        body: page.lines.join("\n"),
      };
    },
    async act(action, o) {
      const signal = o?.signal;
      if (action.type === "navigate") return openUrl(action.url, signal);
      if (action.type === "launch") {
        await tool("launch_app", { name: action.app }, signal);
        current = undefined;
        return;
      }
      const w = await need(signal);
      if (action.type === "click_element") {
        const token = items.get(action.n);
        if (!token) throw new ComputerError("NO_ELEMENT");
        await tool("click", { ...target(w), element_token: token }, signal);
      } else if (action.type === "click")
        await tool("click", { ...target(w), x: action.x, y: action.y }, signal);
      else if (action.type === "type")
        await tool("type_text", { ...target(w), text: action.text }, signal);
      else if (action.type === "key") {
        const keys = pressKey(action.key).split("+");
        if (keys.length > 1) await tool("hotkey", { ...target(w), keys }, signal);
        else await tool("press_key", { ...target(w), key: keys[0] }, signal);
      } else if (action.type === "scroll")
        await tool(
          "scroll",
          { ...target(w), direction: action.direction, amount: action.amount ?? 3 },
          signal,
        );
    },
    async fillCredential(_field: CredentialField) {
      // Passwords are never typed into the person's own desktop by a bot: they sign in themselves.
      throw new ComputerError("UNSUPPORTED");
    },
  };
}
