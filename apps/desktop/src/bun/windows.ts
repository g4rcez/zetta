import Electrobun, { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import type { LauncherRpc } from "../shared/launcher-rpc";
import { decideNavigation } from "./navigation";
import type { Registry, ServerEntry } from "./registry";

const FRAME = { width: 1280, height: 820 } as const;

/**
 * Server windows hold a remote page, so they run sandboxed: no RPC channel to this process. When Phase 2 adds the native bridge it is a
 * separate, narrow channel for the server's own origin (see docs/decisions/desktop-app.md). Flip this only after reading that note.
 */
const SANDBOX_SERVER_WINDOWS = true;

type RpcHandle = ReturnType<typeof BrowserView.defineRPC<LauncherRpc>>;

/** The URL text an Electrobun navigation event carries: a string, or an object with the url. */
const eventUrl = (event: unknown): string => {
  const detail = (event as { data?: { detail?: unknown } } | undefined)?.data?.detail;
  if (typeof detail === "string") return detail;
  const url = (detail as { url?: unknown } | undefined)?.url;
  return typeof url === "string" ? url : "";
};

export type Windows = ReturnType<typeof createWindows>;

/** Opens, finds and hides the app's windows: the launcher (views://launcher) and one window per server. */
export function createWindows(options: {
  registry: Registry;
  launcherRpc: RpcHandle;
  onServerOpened?: (server: ServerEntry) => void;
}) {
  const { registry, launcherRpc } = options;
  const serverWindows = new Map<number, { serverId: string; window: BrowserWindow }>();
  let launcher: BrowserWindow | null = null;
  let quitting = false;

  /** Closing a window hides it and the app stays in the tray; only Quit (or the last window when there is no tray) ends the process. */
  const hideInsteadOfClose = (window: BrowserWindow) =>
    window.on("will-close", (event) => {
      if (quitting) return;
      (event as { response: { allow: boolean } }).response = { allow: false };
      window.hide();
    });

  function showLauncher(): BrowserWindow {
    if (launcher) {
      launcher.show();
      return launcher;
    }
    launcher = new BrowserWindow({
      title: "Zetta",
      url: "views://launcher/index.html",
      frame: { width: 640, height: 600 },
      rpc: launcherRpc,
    });
    const created = launcher;
    hideInsteadOfClose(created);
    created.on("close", () => {
      if (launcher === created) launcher = null;
    });
    return created;
  }

  function openServerWindow(server: ServerEntry, path = "/"): BrowserWindow {
    const url = new URL(path, server.webOrigin).toString();
    const window = new BrowserWindow({
      title: server.name,
      url: null,
      frame: { ...FRAME, x: 120, y: 120 },
      renderer: "cef",
      sandbox: SANDBOX_SERVER_WINDOWS,
      allowedProtocols: { views: false, appData: false },
    });
    // Server windows use CEF's default persistent profile (a sign-in survives a restart), so cookies are kept per host, not per port: two
    // servers on one host share a cookie jar (the launcher warns). A named `persist:` partition per server would isolate them, but with
    // Electrobun 2.0.4 CEF fails to create the browser for one (`CreateBrowserSync returned null`, spike of 2026-11-09), and an
    // ephemeral partition would sign people out on every launch.
    const view = new BrowserView({
      url,
      renderer: "cef",
      windowId: window.id,
      frame: { x: 0, y: 0, ...FRAME },
      sandbox: SANDBOX_SERVER_WINDOWS,
      allowedProtocols: { views: false, appData: false },
    });
    BrowserView.getById(window.webviewId)?.remove();

    const insideOrigins = [server.webOrigin, server.apiOrigin];
    const leave = (event: unknown) => {
      const target = eventUrl(event);
      const decision = decideNavigation(target, insideOrigins);
      if (decision === "inside") return;
      if (decision === "external") Utils.openExternal(target);
      // The page already moved: take it back where it was. (Electrobun cannot cancel a navigation from here.)
      view.executeJavascript("history.back()");
    };
    view.on("did-navigate", leave);
    Electrobun.events.on(`new-window-open-${view.id}`, (event: unknown) => {
      const target = eventUrl(event);
      const decision = decideNavigation(target, insideOrigins);
      if (decision === "external") Utils.openExternal(target);
      // A popup to the server's own pages (the computer viewer) gets its own window.
      if (decision === "inside" && target !== "about:blank") {
        const { pathname, search, hash } = new URL(target);
        openServerWindow(server, `${pathname}${search}${hash}`);
      }
    });

    serverWindows.set(window.id, { serverId: server.id, window });
    hideInsteadOfClose(window);
    window.on("close", () => serverWindows.delete(window.id));
    registry.touch(server.id);
    options.onServerOpened?.(server);
    return window;
  }

  return {
    showLauncher,
    /** Brings the server's window forward, or opens one. `path` only applies to a window that has to be created. */
    openServer(id: string, path?: string): boolean {
      const server = registry.get(id);
      if (!server) return false;
      for (const entry of serverWindows.values()) {
        if (entry.serverId === id) {
          entry.window.show();
          return true;
        }
      }
      openServerWindow(server, path);
      return true;
    },
    /** Closes the windows of a server that was removed from the list. */
    closeServer(id: string) {
      for (const [windowId, entry] of serverWindows) {
        if (entry.serverId !== id) continue;
        serverWindows.delete(windowId);
        entry.window.close();
      }
    },
    /** Brings something forward: the last server window, else the launcher. */
    focusAny() {
      const last = [...serverWindows.values()].at(-1);
      if (last) last.window.show();
      else showLauncher();
    },
    beginQuit() {
      quitting = true;
    },
  };
}
