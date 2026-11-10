import { join } from "node:path";
import Electrobun, { ApplicationMenu, BrowserView, Updater, Utils } from "electrobun/bun";
import type { LauncherRpc } from "../shared/launcher-rpc";
import { discoverServer } from "./discovery";
import { createRegistry, sharesCookiesWith } from "./registry";
import { acquireInstanceLock } from "./single-instance";
import { createTray } from "./tray";
import { createWindows } from "./windows";

const DEV_SERVER_PORT = 3000;
// The web dev server runs on HTTPS (self-signed, or the ZETTA_TLS_CERT/KEY pair of apps/web/.env); HTTP is the fallback for a custom setup.
const DEV_SERVER_ORIGINS = [
  `https://localhost:${DEV_SERVER_PORT}`,
  `http://localhost:${DEV_SERVER_PORT}`,
];

// One app per user: a second launch hands its arguments to this one and exits.
let focusRunning: () => void = () => {};
const lock = await acquireInstanceLock(
  join(Utils.paths.userData, "run"),
  process.argv.slice(2),
  () => focusRunning(),
);
if (!lock) process.exit(0);
process.on("exit", () => lock.release());

const registry = createRegistry(join(Utils.paths.userData, "servers.json"));

/** In the dev channel, the repository's web dev server is a server too (it proxies /api, so web and API share the origin). */
async function addDevServer() {
  if ((await Updater.localInfo.channel()) !== "dev") return;
  for (const origin of DEV_SERVER_ORIGINS) {
    try {
      // Only a liveness probe: Bun does not read the macOS keychain, so the local mkcert CA is unknown to it. The webview trusts it.
      await fetch(origin, { method: "HEAD", tls: { rejectUnauthorized: false } });
      registry.add({ name: "Dev server", kind: "dev", webOrigin: origin, apiOrigin: origin });
      return;
    } catch {}
  }
  console.log("Web dev server not running. Run dev:hmr for live reload.");
}
await addDevServer();

const launcherRpc = BrowserView.defineRPC<LauncherRpc>({
  handlers: {
    requests: {
      listServers: () => registry.list(),
      addServer: async ({ address }) => {
        const found = await discoverServer(address);
        if (found.status !== "found") return found;
        const server = registry.add({
          kind: "remote",
          webOrigin: found.meta.webOrigin,
          apiOrigin: found.meta.apiOrigin,
        });
        servers.changed();
        return {
          status: "added",
          server,
          sharesCookiesWith: sharesCookiesWith(registry.list(), server).map((other) => other.name),
        };
      },
      openServer: ({ id }) => windows.openServer(id),
      removeServer: ({ id }) => {
        windows.closeServer(id);
        const removed = registry.remove(id);
        if (removed) servers.changed();
        return removed;
      },
    },
    messages: {},
  },
});

const windows = createWindows({ registry, launcherRpc });
const tray = createTray({
  openLauncher: () => windows.showLauncher(),
  openServer: (id) => windows.openServer(id),
  quit: () => {
    windows.beginQuit();
    lock.release();
    Utils.quit();
  },
});

/** The list changed: the tray menu and the launcher page show the new one. */
const servers = {
  changed() {
    tray.setServers(registry.list());
    try {
      launcherRpc.send.serversChanged(registry.list());
    } catch {
      // The launcher window is not open: it reads the list when it opens.
    }
  },
};
servers.changed();

focusRunning = () => windows.focusAny();
Electrobun.events.on("reopen", () => windows.focusAny());
Electrobun.events.on("before-quit", () => {
  windows.beginQuit();
  lock.release();
});

// macOS only: without an application menu the standard shortcuts (copy, paste, quit) do nothing in the web pages.
if (process.platform === "darwin") {
  ApplicationMenu.setApplicationMenu([
    {
      label: "Zetta",
      submenu: [
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "divider" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { label: "View", submenu: [{ role: "toggleFullScreen" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
  ]);
}

// Open where the person left off: the most recently opened server, or the only one. With none, the launcher asks for an address.
const known = registry
  .list()
  .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
const first = known[0];
if (first && (first.lastOpenedAt || known.length === 1)) windows.openServer(first.id);
else windows.showLauncher();

console.log("Zetta desktop started.");
