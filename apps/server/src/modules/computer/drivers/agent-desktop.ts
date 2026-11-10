import { ComputerError } from "../service";
import { pickInput, type AxElement } from "../../integrations/plugins/credentials";
import type { CredentialField } from "../../integrations/plugins/registry";
import { Passthrough, type DesktopDriver } from "./types";

/** Runs one command (agent-desktop, or xdotool next to it) on the desktop being driven. */
export type Run = (
  args: string[],
  o?: { signal?: AbortSignal | undefined; timeout?: number },
) => Promise<{ code: number; stdout: string }>;
export type AgentDesktopDeps = { cli: Run; xdotool: Run };

type Box = { x: number; y: number; width: number; height: number };
type Node = {
  role?: string;
  name?: string;
  ref_id?: string;
  states?: string[];
  bounds?: Box;
  children?: Node[];
};
type Envelope = { ok: boolean; data?: any; error?: { code?: string } };
type Item = { ref: string; role: string; label: string; box: Box | undefined; offscreen: boolean };
type Page = {
  lines: string[];
  items: Map<number, Item>;
  inputs: (AxElement & { ref: string })[];
  focusedInput: string | undefined;
  omnibox: string | undefined;
  insecure: boolean;
};

const CALL_MS = 30_000;
const INTERACTIVE = new Set([
  "link",
  "button",
  "menubutton",
  "textfield",
  "checkbox",
  "radiobutton",
  "combobox",
  "menuitem",
  "switch",
  "tab",
  "slider",
  "treeitem",
]);
const KEY_NAMES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  backspace: "BackSpace",
  delete: "Delete",
  space: "space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  pageup: "Prior",
  pagedown: "Next",
  home: "Home",
  end: "End",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  shift: "shift",
  super: "super",
  cmd: "super",
  meta: "super",
};

/** "ctrl+l" / "Return" as xdotool names it. agent-desktop's own `press` crashes Chromium on the VM display (see the decision doc). */
export function xdotoolKey(key: string) {
  const parts = key
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[A-Za-z0-9_]{1,20}$/.test(p)))
    throw new ComputerError("INVALID");
  return parts.map((p) => KEY_NAMES[p.toLowerCase()] ?? p).join("+");
}

function* walk(n: Node): Generator<Node> {
  yield n;
  for (const c of n.children ?? []) yield* walk(c);
}
const clean = (x?: string) => (x ?? "").replace(/\s+/g, " ").trim();

/**
 * The page as text, from agent-desktop's accessibility tree. Only the web content is numbered and listed (the browser's own toolbar is
 * not the page); the omnibox, the focused input and the "Not secure" badge are kept aside for the credential fill.
 */
/** `whole`: read the whole window, for a native app with no web page in it (the host desktop). Default: only the web page. */
export function parsePage(tree: Node, o: { whole?: boolean } = {}): Page {
  const page: Page = {
    lines: [],
    items: new Map(),
    inputs: [],
    focusedInput: undefined,
    omnibox: undefined,
    insecure: false,
  };
  for (const n of walk(tree)) {
    if (n.name === "Address and search bar" && n.ref_id) page.omnibox = n.ref_id;
    if (n.role === "button" && /^not secure$/i.test(n.name ?? "")) page.insecure = true;
    if (n.role === "textfield" && n.ref_id && n.states?.includes("focused"))
      page.focusedInput = n.ref_id;
  }
  const web = [...walk(tree)].find((n) => n.role === "webarea") ?? (o.whole ? tree : undefined);
  if (!web) return page;
  let last = "";
  const visit = (n: Node, skip: string) => {
    const name = clean(n.name);
    const interactive = Boolean(n.ref_id) && INTERACTIVE.has(n.role ?? "");
    if (interactive) {
      const index = page.items.size,
        offscreen = Boolean(n.states?.includes("offscreen")),
        secure = Boolean(n.states?.includes("secure"));
      page.items.set(index, {
        ref: n.ref_id!,
        role: n.role!,
        label: name,
        box: n.bounds,
        offscreen,
      });
      page.lines.push(
        `[${index}] ${n.role} "${name}"${secure ? " (password)" : ""}${offscreen ? " (off-screen)" : ""}`,
      );
      last = "";
      if (n.role === "textfield" && n.bounds)
        page.inputs.push({
          ref: n.ref_id!,
          // agent-desktop reports every input as a textfield; cua names the kinds, and pickInput expects its names.
          role: secure ? "password text" : "entry",
          label: name,
          enabled: !n.states?.includes("disabled"),
          in_web_content: true,
          frame: { x: n.bounds.x, y: n.bounds.y, w: n.bounds.width, h: n.bounds.height },
        });
      for (const c of n.children ?? []) visit(c, name);
      return;
    }
    if (n.role === "statictext" && name && name !== skip && name !== last) {
      page.lines.push(name);
      last = name;
    }
    for (const c of n.children ?? []) visit(c, skip);
  };
  visit(web, "");
  return page;
}

/** Drives a desktop through agent-desktop's CLI (one JSON envelope per command), plus xdotool for the keys it cannot send. */
export function createAgentDesktopDriver(
  { cli, xdotool }: AgentDesktopDeps,
  { browser: withBrowser = true } = {},
): DesktopDriver {
  /** Elements numbered by the last read, so click_element{n} can find [n] again, by label, when the page shifted. */
  let items = new Map<number, Item>();
  let lastTitle: string | undefined;

  async function run(args: string[], signal?: AbortSignal): Promise<Envelope> {
    const r = await cli(args, { signal, timeout: CALL_MS });
    if (signal?.aborted) throw new ComputerError("CANCELLED");
    let e: Envelope | undefined;
    try {
      e = JSON.parse(r.stdout) as Envelope;
    } catch {
      /* not an envelope: the container or the session is gone */
    }
    // Not an envelope means the transport failed; the service turns that into DISCONNECTED and the next start reattaches.
    if (typeof e?.ok !== "boolean") throw new Error("agent-desktop gave no envelope");
    return e;
  }
  const keys = async (args: string[], signal?: AbortSignal) => {
    const r = await xdotool(args, { signal, timeout: CALL_MS });
    if (signal?.aborted) throw new ComputerError("CANCELLED");
    if (r.code !== 0) throw new ComputerError("UNAVAILABLE");
  };
  const must = (e: Envelope) => {
    if (!e.ok) throw new ComputerError("UNAVAILABLE");
    return e;
  };

  async function browser(signal?: AbortSignal) {
    const e = await run(["list-windows"], signal);
    const list = (e.ok ? e.data : []) as { id: string; app_name: string; title: string }[];
    return list.find((w) => /chromium/i.test(w.app_name));
  }
  async function snapshot(signal?: AbortSignal) {
    const e = must(
      await run(
        ["snapshot", "--app", "chromium", "--include-bounds", "--compact", "--max-depth", "30"],
        signal,
      ),
    );
    return parsePage(e.data.tree as Node);
  }
  const center = (b: Box) => `${Math.round(b.x + b.width / 2)},${Math.round(b.y + b.height / 2)}`;

  async function clickItem(item: Item, signal?: AbortSignal) {
    if ((await run(["click", item.ref], signal)).ok) return;
    // The page changed since the read (the ref is stale) or the element offers no semantic click: find it again by what it says.
    const page = await snapshot(signal);
    const again = [...page.items.values()].find(
      (x) => x.role === item.role && x.label === item.label,
    );
    items = page.items;
    if (!again) throw new ComputerError("NO_ELEMENT");
    if ((await run(["click", again.ref], signal)).ok) return;
    if (!again.box || again.offscreen) throw new ComputerError("NO_ELEMENT");
    must(await run(["mouse-click", `--xy=${center(again.box)}`, "--headed"], signal));
  }

  return {
    async ready() {
      if (!withBrowser) return; // a desktop without a browser has no window to wait for
      // "running" means usable: wait (bounded) for Chromium's window, so a bot's first keystroke has a target.
      let w: Awaited<ReturnType<typeof browser>>;
      for (let i = 0; i < 60 && !w; i++) {
        w = await browser().catch(() => undefined);
        if (!w) await Bun.sleep(500);
      }
      if (w) await run(["focus-window", "--window-id", w.id]).catch(() => undefined);
    },

    async probe() {
      for (let i = 0; i < 2; i++) {
        const e = await run(["status"]).catch(() => undefined);
        if (e?.ok && e.data?.permissions?.accessibility?.state === "granted") return true;
        await Bun.sleep(500);
      }
      return false;
    },

    async act(action, o = {}) {
      const { signal } = o;
      if (action.type === "click")
        must(
          await run(
            ["mouse-click", `--xy=${Math.round(action.x)},${Math.round(action.y)}`, "--headed"],
            signal,
          ),
        );
      else if (action.type === "click_element") {
        const item = items.get(action.n);
        if (!item) throw new ComputerError("NO_ELEMENT");
        await clickItem(item, signal);
      } else if (action.type === "type") {
        const text = action.text.slice(0, 2000);
        // An input that has focus takes the text through its ref (and the value is checked); anything else gets keystrokes.
        const focus = (await snapshot(signal).catch(() => undefined))?.focusedInput;
        if (!focus || !(await run(["type", "--headed", "--", focus, text], signal)).ok)
          await keys(["type", "--clearmodifiers", "--delay", "6", "--", text], signal);
      } else if (action.type === "key")
        await keys(["key", xdotoolKey(action.key.slice(0, 40))], signal);
      else if (action.type === "scroll") {
        const n = Math.max(1, Math.min(20, action.amount ?? 3));
        const d = action.direction;
        must(
          await run(
            [
              "mouse-wheel",
              "--x",
              "640",
              "--y",
              "400",
              "--dy",
              String(d === "up" ? n : d === "down" ? -n : 0),
              "--dx",
              String(d === "right" ? n : d === "left" ? -n : 0),
              "--headed",
            ],
            signal,
          ),
        );
      } else if (action.type === "launch") must(await run(["launch", "--", action.app], signal));
      else {
        // Chromium is always open: focus its window (xdotool sends keys to whatever has focus), then its address bar, type, Enter.
        await keys(
          ["search", "--onlyvisible", "--class", "chromium", "windowactivate", "--sync"],
          signal,
        );
        await keys(["key", "ctrl+l"], signal);
        await Bun.sleep(150);
        await keys(["type", "--clearmodifiers", "--delay", "6", "--", action.url], signal);
        await keys(["key", "Return"], signal);
      }
    },

    async screenshot() {
      let e = await run(["screenshot", "--screen", "0"]);
      if (!e.ok) {
        const w = await browser();
        if (w) e = await run(["screenshot", "--window-id", w.id]);
      }
      const png = e.ok ? (e.data?.data as unknown) : undefined;
      if (typeof png !== "string" || !png) throw new ComputerError("UNAVAILABLE");
      return png;
    },

    async read(o) {
      const w = await browser(o.signal);
      if (!w) {
        const e = await run(["list-windows"], o.signal);
        const titles = ((e.ok ? e.data : []) as { title: string }[]).map((x) => x.title);
        return { kind: "plain", text: titles.join("\n").slice(0, 2000) || "No windows are open." };
      }
      // After a click or navigate the old page stays on screen for a moment: reading it at once makes the bot think the step failed.
      // Wait (briefly) for Chromium's title to change; a click that does not navigate costs at most ~2 s.
      if (o.settle)
        for (let i = 0; i < 7; i++) {
          await Bun.sleep(300);
          const title = (await browser(o.signal))?.title;
          if (title !== undefined && title !== lastTitle) break;
        }
      let page = await snapshot(o.signal);
      // A page still loading has an almost empty tree: give it one more moment.
      if (o.settle && page.lines.join("\n").length < 400) {
        await Bun.sleep(900);
        page = await snapshot(o.signal);
      }
      const title = (await browser(o.signal))?.title ?? w.title;
      lastTitle = title;
      items = page.items;
      return { kind: "page", title, body: page.lines.join("\n") };
    },

    /**
     * The input is picked here from the page's tree (pickInput) and the address comes from the omnibox value, which Chromium shows without
     * `https://`: it is put back unless the badge says "Not secure". The value is typed through the input's ref and never read back.
     */
    async fillCredential(field: CredentialField, reveal) {
      const page = await snapshot();
      if (page.insecure) throw new ComputerError("INSECURE");
      const input = pickInput(field, page.inputs) as (AxElement & { ref: string }) | undefined;
      if (!input) throw new ComputerError("NO_INPUT");
      if (!page.omnibox) throw new ComputerError("NO_ADDRESS");
      const got = await run(["get", page.omnibox, "--property", "value"]);
      const shown = clean(got.ok ? (got.data?.value as string | undefined) : undefined);
      const url = !shown ? "" : /^[a-z][a-z0-9+.-]*:/i.test(shown) ? shown : `https://${shown}`;
      if (!/^https?:\/\/\S+$/i.test(url)) throw new ComputerError("NO_ADDRESS");
      const value = await reveal(url).catch((e: unknown) => {
        throw new Passthrough(e);
      }); // the grant's own refusal, not a transport failure
      must(await run(["type", "--headed", "--", input.ref, value.slice(0, 2000)]));
      return { label: input.label ?? field };
    },
  };
}
