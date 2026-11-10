import { ComputerError } from "../service";
import type { CredentialField } from "../../integrations/plugins/registry";
import { parsePage, type Run } from "./agent-desktop";
import type { DesktopDriver } from "./types";

/**
 * The computer Zetta runs on (target "local"), driven through agent-desktop on the host. Only on a local install (see placement.ts):
 * the person's own desktop, with every app they have open. "Read" is the focused window (or the first visible one) as numbered
 * elements; "launch" opens an app by name; keys use agent-desktop's `press` (the host has no xdotool).
 *
 * macOS asks the person to allow it: the app that runs Zetta needs Accessibility (to read and press) and Screen Recording (for
 * screenshots). Without them every window reads as not accessible; the driver says so with the exact fix instead of failing silently.
 */
type Envelope = { ok: boolean; data?: any; error?: { code?: string; message?: string } };
type Window = {
  id: string;
  app_name: string;
  title: string;
  accessible?: boolean;
  is_focused?: boolean;
  visible?: boolean;
};

const CALL_MS = 30_000;

export const NEEDS_PERMISSION_DETAIL =
  "Allow the app that runs Zetta to control this computer (macOS: System Settings > Privacy & Security > Accessibility; Linux: turn on the accessibility bus, AT-SPI; Windows: run Zetta as the signed-in user, not elevated). Then try again.";

/** agent-desktop's own permission report (macOS, Linux and Windows): each capability with its state and, when missing, how to fix it. */
type Permissions = Record<string, { state?: string; suggestion?: string } | undefined>;
/** Pure: the fix to show when a capability is not granted, or undefined when it is usable. */
export function permissionProblem(
  p: Permissions | undefined,
  capability: "accessibility" | "screen_recording",
) {
  const c = p?.[capability];
  if (!c || c.state === "granted" || c.state === "unknown" || c.state === "not_needed")
    return undefined;
  return c.suggestion || NEEDS_PERMISSION_DETAIL;
}

/** The first element ref of a snapshot tree (the focused element when the snapshot was of the focused surface). */
function firstRef(tree: unknown): string | undefined {
  const stack = tree ? [tree as { ref_id?: string; children?: unknown[] }] : [];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.ref_id) return n.ref_id;
    stack.push(...((n.children ?? []) as never[]));
  }
  return undefined;
}

/** Pure: the window the bot works in, or why there is none. */
export function pickWindow(list: Window[]): Window | "no_access" | "none" {
  const visible = list.filter((w) => w.visible !== false);
  if (!visible.length) return "none";
  if (visible.every((w) => w.accessible === false)) return "no_access";
  const usable = visible.filter((w) => w.accessible !== false);
  return usable.find((w) => w.is_focused) ?? usable[0]!;
}

/** "ctrl+l", "Return", "cmd+c" as agent-desktop's `press` names them. */
export function pressKey(key: string) {
  return key
    .split("+")
    .map((k) => k.trim().toLowerCase())
    .map((k) => (k === "control" ? "ctrl" : k === "command" || k === "super" ? "cmd" : k))
    .join("+");
}

export function createHostAgentDesktopDriver(
  cli: Run,
  /** Opens an address in the person's default browser (macOS `open <url>`), signed in as they are. */
  openUrl: (url: string, signal?: AbortSignal) => Promise<void>,
): DesktopDriver {
  let items = new Map<number, { ref: string; label: string; role: string }>();
  async function run(args: string[], signal?: AbortSignal): Promise<Envelope> {
    const r = await cli(args, { signal, timeout: CALL_MS });
    if (signal?.aborted) throw new ComputerError("CANCELLED");
    let e: Envelope | undefined;
    try {
      e = JSON.parse(r.stdout) as Envelope;
    } catch {
      /* no envelope: the tool is missing or crashed */
    }
    if (typeof e?.ok !== "boolean") throw new Error("agent-desktop gave no envelope");
    return e;
  }
  const must = (e: Envelope) => {
    if (e.ok) return e;
    if (
      e.error?.code === "PERMISSION_DENIED" ||
      /permission|accessib/i.test(e.error?.message ?? "")
    )
      throw new ComputerError("UNAVAILABLE", NEEDS_PERMISSION_DETAIL);
    throw new ComputerError("UNAVAILABLE");
  };
  async function window(signal?: AbortSignal) {
    const e = must(await run(["list-windows"], signal));
    const w = pickWindow((e.data ?? []) as Window[]);
    if (w === "no_access") throw new ComputerError("UNAVAILABLE", NEEDS_PERMISSION_DETAIL);
    return w === "none" ? undefined : w;
  }
  async function permissions() {
    const e = await run(["permissions"]).catch(() => undefined);
    return e?.ok ? (e.data as Permissions) : undefined;
  }
  return {
    async ready() {
      const problem = permissionProblem(await permissions(), "accessibility");
      if (problem) throw new ComputerError("UNAVAILABLE", problem);
      await window();
    },
    async probe() {
      return run(["list-windows"]).then(
        (e) => e.ok,
        () => false,
      );
    },
    async act(action, o) {
      const signal = o?.signal;
      if (action.type === "click_element") {
        const item = items.get(action.n);
        if (!item) throw new ComputerError("NO_ELEMENT");
        must(await run(["click", item.ref], signal));
      } else if (action.type === "click")
        must(
          await run(
            ["mouse-click", `--xy=${Math.round(action.x)},${Math.round(action.y)}`, "--headed"],
            signal,
          ),
        );
      else if (action.type === "type") {
        // `type` needs a target: the element that has the keyboard focus in the window the bot works in.
        const w = await window(signal);
        const e = must(
          await run(
            [
              "snapshot",
              "--surface",
              "focused",
              "--interactive-only",
              ...(w ? ["--window-id", w.id] : []),
            ],
            signal,
          ),
        );
        const ref = firstRef(e.data?.tree);
        if (!ref) throw new ComputerError("NO_INPUT");
        must(await run(["type", "--headed", "--", ref, action.text], signal));
      } else if (action.type === "key") must(await run(["press", pressKey(action.key)], signal));
      else if (action.type === "scroll") {
        // `scroll` needs a ref: the window's own root from a shallow snapshot.
        const w = await window(signal);
        if (!w) throw new ComputerError("NO_ELEMENT");
        const e = must(await run(["snapshot", "--window-id", w.id, "--skeleton"], signal));
        const ref = (e.data?.tree as { ref_id?: string } | undefined)?.ref_id;
        if (!ref) throw new ComputerError("NO_ELEMENT");
        must(
          await run(
            [
              "scroll",
              ref,
              "--direction",
              action.direction,
              "--amount",
              String(action.amount ?? 3),
            ],
            signal,
          ),
        );
      } else if (action.type === "launch")
        must(await run(["launch", "--activate", "--", action.app], signal));
      else if (action.type === "navigate")
        // The person's own browser: the system opens the address in their default browser, signed in as they are.
        await openUrl(action.url, signal);
    },
    async screenshot() {
      const problem = permissionProblem(await permissions(), "screen_recording");
      if (problem) throw new ComputerError("UNAVAILABLE", problem);
      const w = await window();
      const e = must(await run(w ? ["screenshot", "--window-id", w.id] : ["screenshot"]));
      const png = (e.data as { png?: string; base64?: string } | undefined)?.png ?? e.data?.base64;
      if (typeof png !== "string") throw new ComputerError("UNAVAILABLE");
      return png;
    },
    async read(o) {
      const w = await window(o.signal);
      if (!w) return { kind: "plain", text: "No windows are open." };
      const e = must(
        await run(
          ["snapshot", "--window-id", w.id, "--include-bounds", "--compact", "--max-depth", "30"],
          o.signal,
        ),
      );
      // A web page inside the window is read as before; a native app (no web page) is read whole.
      const page = parsePage(e.data.tree, { whole: true });
      items = new Map(
        [...page.items].map(([n, x]) => [n, { ref: x.ref, label: x.label, role: x.role }]),
      );
      return { kind: "page", title: `${w.app_name}: ${w.title}`, body: page.lines.join("\n") };
    },
    async fillCredential(_field: CredentialField) {
      // Passwords are never typed into the person's own desktop by a bot: they sign in themselves.
      throw new ComputerError("UNSUPPORTED");
    },
  };
}
