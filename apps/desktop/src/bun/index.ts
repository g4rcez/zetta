import { appendFileSync } from "node:fs";
import { join } from "node:path";
import Electrobun, { ApplicationMenu, BrowserView, Updater, Utils } from "electrobun/bun";
import type { LauncherRpc } from "../shared/launcher-rpc";
import { discoverServer } from "./discovery";
import { attachLocalServer } from "./local";
import { createApprovals } from "./companion/approvals";
import { createCompanion } from "./companion/client";
import { createGrants } from "./companion/policy";
import { createRegistry, sharesCookiesWith } from "./registry";
import { createRemoteLink } from "./remote-link";
import { createSecretBox, macKeychain } from "./secret-box";
import { createTokenStore } from "./token-store";
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
      openServer: ({ id }) =>
        windows.openServer(id, id === local?.entry()?.id ? local.openPath() : undefined),
      localState: () => local?.server.state ?? null,
      startLocal: async () => (local ? await local.server.start() : null),
      stopLocal: async () => {
        if (!local) return null;
        await local.server.stop();
        return local.server.state;
      },
      linkStates: () => remoteLink.states(),
      connectRemote: ({ id }) => remoteLink.connect(id),
      disconnectRemote: async ({ id }) => {
        // Signing out of a server ends what its bots may do on this computer.
        companion.forget(id);
        return remoteLink.disconnect(id);
      },
      sharing: () => sharing(),
      shareComputer: async ({ id, on }) => {
        if (!on) return (companion.disable(id), true);
        return companion.enable(id);
      },
      decideApproval: ({ id, decision }) => approvals.decide(id, decision),
      setSharingPaused: ({ paused }) => (companion.setPaused(paused), true),
      showLocalLog: () => {
        if (!local) return false;
        Utils.showItemInFolder(local.server.state.logFile);
        return true;
      },
      removeServer: ({ id }) => {
        // The server this app runs is not on the list to remove: it is stopped from the launcher.
        if (registry.get(id)?.kind === "local") return false;
        windows.closeServer(id);
        const removed = registry.remove(id);
        if (removed) servers.changed();
        return removed;
      },
    },
    messages: {},
  },
});

/** The server this app runs on this computer (null when it is turned off). */
const local = attachLocalServer({
  registry,
  changed: (state) => {
    servers.changed();
    // A server that just came up has none of the remote tokens: hand them over.
    if (state.status === "running") {
      remoteLink.localRestarted();
      void remoteLink.tick();
    }
    try {
      launcherRpc.send.localChanged(state);
    } catch {
      // The launcher window is not open: it reads the state when it opens.
    }
  },
});

// On macOS the file is sealed with a key kept in the Keychain; elsewhere (or if the Keychain refuses) it stays a private plain file.
const tokenStore = createTokenStore(
  join(Utils.paths.userData, "remote-tokens.json"),
  undefined,
  process.platform === "darwin" && !process.env.ZETTA_DESKTOP_NO_KEYCHAIN
    ? createSecretBox(macKeychain())
    : null,
);

/** Signs in to remote servers and lets this computer's own server use them (see remote-link.ts). */
const remoteLink = createRemoteLink({
  registry,
  tokens: tokenStore,
  // `ZETTA_DESKTOP_OPEN_LOG` (tests only): the sign-in address is appended to that file instead of opening a browser.
  open: (url) =>
    process.env.ZETTA_DESKTOP_OPEN_LOG
      ? appendFileSync(process.env.ZETTA_DESKTOP_OPEN_LOG, `${url}\n`)
      : Utils.openExternal(url),
  clientId: process.env.ZETTA_DESKTOP_CLIENT_ID?.trim() || undefined,
  local: () => {
    const state = local?.server.state;
    const token = local?.server.linkToken;
    return state?.status === "running" && state.origin && token
      ? { origin: state.origin, token }
      : null;
  },
  onChange: () => {
    try {
      launcherRpc.send.linksChanged(remoteLink.states());
    } catch {
      // The launcher window is not open: it reads the states when it opens.
    }
  },
});
remoteLink.start();

/** Lets remote servers' bots work on this computer, with the person here in charge (see companion/). */
const sharing = () => ({
  states: companion.states(),
  paused: companion.paused,
  pending: approvals.list(),
});
const tellLauncher = () => {
  try {
    launcherRpc.send.sharingChanged(sharing());
  } catch {
    // The launcher window is not open: it reads the state when it opens.
  }
  tray.setSharing({
    active: Object.values(companion.states()).some((s) => s.enabled),
    paused: companion.paused,
  });
};
const approvals = createApprovals({ onChange: tellLauncher });
const companion = createCompanion({
  registry,
  tokens: tokenStore,
  grants: createGrants(join(Utils.paths.userData, "companion-grants.json")),
  approvals,
  accessToken: (id) => remoteLink.freshAccessToken(id),
  // A request waits for the person: bring the launcher forward, where the question is.
  attention: () => windows.showLauncher(),
  onChange: tellLauncher,
});

const windows = createWindows({ registry, launcherRpc });
const tray = createTray({
  openLauncher: () => windows.showLauncher(),
  openServer: (id) => windows.openServer(id),
  togglePause: () => companion.setPaused(!companion.paused),
  quit: () => {
    companion.stop();
    windows.beginQuit();
    lock.release();
    // The server (and the Postgres inside it) stops first; the app quits when it has, or after a few seconds.
    if (local) void local.server.stop().finally(() => Utils.quit());
    else Utils.quit();
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
companion.start();

focusRunning = () => windows.focusAny();
Electrobun.events.on("reopen", () => windows.focusAny());
Electrobun.events.on("before-quit", () => {
  windows.beginQuit();
  lock.release();
  if (local) void local.server.stop();
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
const resumes = Boolean(first && (first.lastOpenedAt || known.length === 1));
// A local server entry is opened below, when the server answers; opening its address now would show an error page.
const resumesLocal = resumes && Boolean(local) && first?.kind === "local";
if (resumes && !resumesLocal && first) windows.openServer(first.id);
else if (!resumesLocal) windows.showLauncher();

// The local server starts in the background; its window opens when it answers, if it is where the person left off (or is the first run).
if (local) {
  const lastWasLocal = first?.kind === "local" && Boolean(first.lastOpenedAt);
  const fresh = known.length === 0;
  void local.server.start().then((state) => {
    const entry = local.entry();
    if (state.status !== "running" || !entry) {
      windows.showLauncher();
      return;
    }
    if (lastWasLocal || fresh || !entry.lastOpenedAt)
      windows.openServer(entry.id, local.openPath());
  });
}

console.log("Zetta desktop started.");
