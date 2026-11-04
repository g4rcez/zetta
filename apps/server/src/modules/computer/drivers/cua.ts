import { ComputerError } from "../service";
import type { McpCall } from "../mcp-client";
import { pickInput, type AxElement } from "../../integrations/plugins/credentials";
import { Passthrough, type DesktopDriver } from "./types";

/**
 * cua-driver input on Xvfb (checked against cua-spacesd 0.8.0): background delivery needs uinput, which a virtual X server cannot add,
 * so input is delivered in the foreground (the desktop is private to this VM); coordinates are screen pixels (scope "desktop").
 */
const FG = { delivery_mode: "foreground" } as const;
const SCREEN = { scope: "desktop", ...FG } as const;
const CLICKABLE =
  /^(button|link|entry|check box|radio button|combo box|menu item|tab|toggle button|list item|password text|text|heading)$/;

/**
 * The accessibility tree as readable text: page content sits hundreds of rows deep under unlabelled panels and sections, so the raw tree
 * runs out of budget in the site's header. Keeps one line per element that has text (role and label), drops actions, indices, the
 * placeholder characters of empty containers and a label repeated by its own child.
 */
export function compactTree(tree: string, numbered?: Map<number, string>) {
  const out: string[] = [];
  let last = "";
  for (const raw of tree.split("\n")) {
    const m =
      /^\s*- (?:\[(\d+)\] )?([a-z][a-z ]*?)(?: = | )"(.*?)"(?: \(description "(.*?)"\))?(?: .*)?$/.exec(
        raw.replace(/￼/g, ""),
      );
    if (!m) continue;
    const [, index, role = "", label = "", description = ""] = m;
    const text = (label.trim() || description.trim()).replace(/\s+/g, " ");
    if (!text || text === last) continue;
    last = text;
    const plain = role === "static" || role === "section" || role === "panel";
    // Clickable elements keep their index (when asked for), so the bot can click_element{n} instead of guessing coordinates.
    const n = numbered && index !== undefined && CLICKABLE.test(role) ? Number(index) : undefined;
    if (n !== undefined) numbered!.set(n, label.trim());
    out.push(`${n !== undefined ? `[${n}] ` : ""}${plain ? text : `${role} "${text}"`}`);
  }
  return out.join("\n");
}

/** "ctrl+l" style combos go through hotkey; a single key through press_key. */
const pressKey = (call: McpCall, key: string) => {
  const keys = key
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length > 1 ? call("hotkey", { keys, ...FG }) : call("press_key", { key, ...FG });
};

/** Chromium's window on the desktop (the one bots drive), as list_windows reports it. */
async function chromium(call: McpCall) {
  const windows = await call("list_windows", {});
  const found = [...windows.text.matchAll(/window_id=(\d+) pid=(\d+) "([^"]*)"/g)];
  const top = found.find((m) => /chromium/i.test(m[3]!));
  return windows.isError || !top ? undefined : { window_id: Number(top[1]), pid: Number(top[2]) };
}

/**
 * Foreground input needs an active window. Openbox has none right after boot, or after the focused window closed, and cua-driver then
 * refuses with `foreground_unavailable` without sending anything: activate Chromium and retry that one call once.
 */
const focused =
  (call: McpCall): McpCall =>
  async (tool, args) => {
    const r = await call(tool, args);
    if (!r.isError || !/foreground_unavailable/.test(r.text)) return r;
    const win = await chromium(call).catch(() => undefined);
    if (!win) return r;
    await call("bring_to_front", win).catch(() => undefined);
    return call(tool, args);
  };

/** Drives a desktop through cua-driver's MCP tools (here: cua-spacesd's `/mcp` inside a VM). `raw` is the session's transport. */
export function createCuaDriver(raw: McpCall, { browser = true } = {}): DesktopDriver {
  /** Chromium's window, cached between actions; dropped when a call on it fails. */
  let win: { window_id: number; pid: number } | undefined;
  /** Labels of the numbered elements in the last read, so click_element can find [n] again if the page shifted. */
  let labels: Map<number, string> | undefined;
  /** Chromium's window title at the last read, to see when an action changed the page. */
  let lastTitle: string | undefined;

  const windowOf = async (call: McpCall) => (win ??= await chromium(call));

  /**
   * Screen point of element [n] from the last read. Indices follow the page's tree order, so they hold while the page is the same; if the
   * element there now has another label, the one with the label the bot saw is used instead. Off-screen or missing: NO_ELEMENT.
   */
  async function elementCenter(call: McpCall, n: number) {
    const w = await windowOf(call);
    if (!w) throw new ComputerError("NO_ELEMENT");
    const r = await call("get_window_state", {
      ...w,
      include_screenshot: false,
      max_elements: Math.min(5000, Math.max(400, n + 100)),
      tree_format: "elements",
    });
    const st = (r.structured ?? {}) as {
      elements?: (AxElement & { element_index?: number })[];
      window_bounds?: { y?: number; height?: number };
    };
    if (r.isError || !Array.isArray(st.elements)) {
      win = undefined;
      throw new ComputerError("UNAVAILABLE");
    }
    const clean = (x?: string) => (x ?? "").replace(/￼/g, "").trim();
    const want = labels?.get(n);
    let el = st.elements.find((e) => e.element_index === n);
    if (want && clean(el?.label) !== want)
      el = st.elements.find((e) => clean(e.label) === want) ?? el;
    const f = el?.frame;
    if (!f || f.w <= 0 || f.h <= 0) throw new ComputerError("NO_ELEMENT");
    // Frames are screen pixels, like click's desktop scope (checked on cua-spacesd 0.8.0: a Hacker News title link at y=158 h=15 opens
    // when clicked at y=166, although the state says coordinate_frame "window"). Only the visible part of the element counts.
    const top = Math.max(f.y, st.window_bounds?.y ?? 0),
      bottom = Math.min(
        f.y + f.h,
        (st.window_bounds?.y ?? 0) + (st.window_bounds?.height ?? 10_000),
      );
    if (bottom <= top) throw new ComputerError("NO_ELEMENT"); // scrolled out of view
    return { x: Math.round(f.x + f.w / 2), y: Math.round((top + bottom) / 2) };
  }

  return {
    async ready() {
      if (!browser) return; // a desktop without a browser has no window to wait for
      // "running" means usable: wait (bounded) for Chromium's window, so a bot's first keystroke has a target.
      for (let i = 0; i < 60; i++) {
        const w = await raw("list_windows", {}).catch(() => undefined);
        if (w && !w.isError && /window_id=\d+ pid=\d+ "[^"]*Chromium/i.test(w.text)) break;
        await Bun.sleep(500);
      }
      // Right after boot no window is active, and foreground input is refused until one is (see `focused`).
      const front = await chromium(raw).catch(() => undefined);
      if (front) await raw("bring_to_front", front).catch(() => undefined);
    },

    async probe() {
      // spacesd may be busy for a moment: one retry before the caller gives up and restarts the container (open tabs are lost).
      const probe =
        (await raw("list_windows", {}).catch(() => undefined)) ??
        (await Bun.sleep(500).then(() => raw("list_windows", {}).catch(() => undefined)));
      return Boolean(probe) && !probe!.isError;
    },

    async act(action, o = {}) {
      const call = focused((tool, args) => raw(tool, args, { signal: o.signal }));
      let r;
      if (action.type === "click_element") {
        const at = await elementCenter(call, action.n);
        r = await call("click", { x: at.x, y: at.y, ...SCREEN });
      } else if (action.type === "click")
        r = await call("click", { x: Math.round(action.x), y: Math.round(action.y), ...SCREEN });
      else if (action.type === "type")
        r = await call("type_text", { text: action.text.slice(0, 2000), ...FG });
      else if (action.type === "key") r = await pressKey(call, action.key.slice(0, 40));
      else if (action.type === "scroll")
        r = await call("scroll", {
          direction: action.direction,
          amount: Math.max(1, Math.min(20, action.amount ?? 3)),
          x: 640,
          y: 400,
          ...SCREEN,
        });
      else if (action.type === "launch") r = await call("launch_app", { name: action.app });
      else {
        // Chromium is always open: focus its address bar, type, Enter.
        r = await call("hotkey", { keys: ["ctrl", "l"], ...FG });
        if (!r.isError) r = await call("type_text", { text: action.url, ...FG });
        if (!r.isError) r = await call("press_key", { key: "Return", ...FG });
      }
      if (r.isError) throw new ComputerError("UNAVAILABLE");
    },

    async screenshot() {
      const r = await raw("get_desktop_state", {});
      if (r.isError || !r.imageBase64) throw new ComputerError("UNAVAILABLE");
      return r.imageBase64;
    },

    async read(o) {
      const call: McpCall = (tool, args) => raw(tool, args, { signal: o.signal });
      const w = await windowOf(call);
      if (!w) {
        const windows = await call("list_windows", {});
        return { kind: "plain", text: windows.text.slice(0, 2000) || "No windows are open." };
      }
      const once = async () => {
        const r = await call("get_window_state", {
          ...w,
          include_screenshot: false,
          max_elements: o.settle ? 800 : 1500,
        });
        if (r.isError) {
          win = undefined; // the window may have closed: look it up again next time
          throw new ComputerError("UNAVAILABLE");
        }
        return r.text;
      };
      // After a click or navigate the old page stays on screen for a moment: reading it at once makes the bot think the step failed.
      // Wait (briefly) for Chromium's title to change; a click that does not navigate costs at most ~2 s.
      if (o.settle)
        for (let i = 0; i < 7; i++) {
          await Bun.sleep(300);
          const title = /"([^"]*)"/.exec(
            (await call("list_windows", {})).text.match(
              new RegExp(`window_id=${w.window_id} [^\\n]*`),
            )?.[0] ?? "",
          )?.[1];
          if (title !== undefined && title !== lastTitle) break;
        }
      let tree = await once();
      // A page still loading has an almost empty tree: give it one more moment.
      if (o.settle && compactTree(tree).length < 400) {
        await Bun.sleep(900);
        tree = await once();
      }
      const title = /"([^"]*)"/.exec(
        tree.split("\n").find((l) => /\[0\] frame/.test(l)) ?? "",
      )?.[1];
      lastTitle = title;
      labels = new Map();
      return { kind: "page", title, body: compactTree(tree, labels) };
    },

    /**
     * Checked against cua-spacesd 0.8.0: its accessibility tree carries roles, labels and frames but neither field values nor focus, so
     * the input is picked here (by role/label, see pickInput) and the real address is read from the omnibox through the desktop's own
     * clipboard (restored afterwards). The value is typed and never read back.
     */
    async fillCredential(field, reveal) {
      const call = focused(raw),
        w = await chromium(call);
      if (!w) throw new ComputerError("NO_ADDRESS");
      const state = await call("get_window_state", {
        ...w,
        include_screenshot: false,
        max_elements: 400,
        tree_format: "elements",
      });
      const st = (state.structured ?? {}) as {
        elements?: AxElement[];
        window_bounds?: { x?: number; y?: number };
      };
      if (state.isError || !Array.isArray(st.elements)) throw new ComputerError("UNAVAILABLE");
      if (st.elements.some((e) => e.role === "button" && /^not secure$/i.test(e.label ?? "")))
        throw new ComputerError("INSECURE");
      const input = pickInput(field, st.elements);
      if (!input?.frame) throw new ComputerError("NO_INPUT");
      const text = (r: Awaited<ReturnType<McpCall>>) => {
        const t = (r.structured as { text?: unknown } | undefined)?.text;
        return typeof t === "string" ? t : undefined;
      };
      const before = text(await call("clipboard_read", { include_text: true }));
      let url: string | undefined;
      try {
        if (
          !(await call("hotkey", { keys: ["ctrl", "l"], ...FG })).isError &&
          !(await call("hotkey", { keys: ["ctrl", "c"], ...FG })).isError
        )
          url = text(await call("clipboard_read", { include_text: true }))?.trim();
      } finally {
        await call("press_key", { key: "Escape", ...FG }).catch(() => undefined);
        await call("clipboard_write", { text: before ?? "" }).catch(() => undefined);
      }
      if (!url || !/^https?:\/\/\S+$/i.test(url)) throw new ComputerError("NO_ADDRESS");
      const value = await reveal(url).catch((e: unknown) => {
        throw new Passthrough(e);
      }); // the grant's own refusal, not a transport failure
      const ox = st.window_bounds?.x ?? 0,
        oy = st.window_bounds?.y ?? 0,
        f = input.frame;
      let r = await call("click", {
        x: Math.round(ox + f.x + f.w / 2),
        y: Math.round(oy + f.y + f.h / 2),
        ...SCREEN,
      });
      if (!r.isError) r = await call("type_text", { text: value.slice(0, 2000), ...FG });
      if (r.isError) throw new ComputerError("UNAVAILABLE");
      return { label: input.label ?? field };
    },
  };
}
