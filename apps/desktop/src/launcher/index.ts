import { Electroview } from "electrobun/view";
import type { LocalState } from "../bun/local-server";
import type { ServerEntry } from "../bun/registry";
import type { Sharing } from "../shared/launcher-rpc";
import type { ConnectResult, LinkState } from "../bun/remote-link";
import type { AddServerResult, LauncherRpc } from "../shared/launcher-rpc";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = byId<HTMLUListElement>("servers");
const empty = byId<HTMLParagraphElement>("empty");
const form = byId<HTMLFormElement>("add");
const address = byId<HTMLInputElement>("address");
// Not `status`: a top-level `status` in a classic script is `window.status`, a string, and assigning to it would swallow every message.
const note = byId<HTMLParagraphElement>("status");

const problems: Record<Exclude<AddServerResult["status"], "added">, string> = {
  "invalid-address": "That is not a web address. Use something like zetta.example.com.",
  unreachable: "Could not reach that address. Check it and your connection.",
  "not-zetta": "That address answered, but it is not a Zetta server this app can use.",
  "newer-protocol": "That server needs a newer version of this app.",
};

const say = (text: string, kind: "info" | "error" = "info") => {
  note.textContent = text;
  note.className = kind === "error" ? "error" : "";
};

let links: Record<string, LinkState> = {};
let share: Sharing = { states: {}, paused: false, pending: [] };

const approvalsBox = byId<HTMLElement>("approvals");
const sharingBox = byId<HTMLElement>("sharing");
const sharingText = byId<HTMLDivElement>("sharing-state");
const sharingToggle = byId<HTMLButtonElement>("sharing-toggle");

function renderSharing(next: Sharing) {
  share = next;
  const on = Object.values(next.states).filter((state) => state.enabled).length;
  sharingBox.hidden = on === 0;
  sharingText.textContent = next.paused
    ? "Paused: nothing can run here until you resume."
    : `${on} server${on === 1 ? "" : "s"} can ask to use it. You decide each time, unless you allowed a bot.`;
  sharingToggle.textContent = next.paused ? "Resume" : "Pause";

  approvalsBox.hidden = next.pending.length === 0;
  approvalsBox.replaceChildren(
    ...next.pending.map((item) => {
      const card = document.createElement("div");
      card.className = "approval";
      const title = document.createElement("div");
      title.className = "name";
      title.textContent = `${item.bot} on ${item.serverName} wants to ${item.method === "run" ? "run" : "list"}:`;
      const what = document.createElement("pre");
      what.textContent = item.detail;
      card.append(title, what);
      if (item.guarded.length) {
        const warning = document.createElement("div");
        warning.className = "origin error";
        warning.textContent = `This uses ${item.guarded.join(", ")}, which always asks.`;
        card.append(warning);
      }
      const buttons = document.createElement("div");
      buttons.className = "row";
      const choose = (label: string, decision: "once" | "always" | "deny", cls: string) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = cls;
        button.textContent = label;
        button.addEventListener(
          "click",
          () => void rpc.request.decideApproval({ id: item.id, decision }),
        );
        return button;
      };
      buttons.append(
        choose("Allow once", "once", "primary"),
        ...(item.guarded.length ? [] : [choose(`Always for ${item.bot}`, "always", "")]),
        choose("Deny", "deny", "quiet"),
      );
      card.append(buttons);
      return card;
    }),
  );
}

sharingToggle.addEventListener("click", async () => {
  await rpc.request.setSharingPaused({ paused: !share.paused });
  renderSharing(await rpc.request.sharing({}));
});
let lastServers: ServerEntry[] = [];

const linkProblems: Record<Exclude<ConnectResult, { status: "connected" }>["error"], string> = {
  DISCOVERY_FAILED: "That server does not offer sign-in for this app.",
  DENIED: "Sign-in was cancelled.",
  STATE_MISMATCH: "The answer did not match this sign-in. Try again.",
  TIMEOUT: "Sign-in took too long. Try again.",
  EXCHANGE_FAILED: "The server did not accept the sign-in. Try again.",
  REFRESH_FAILED: "Sign-in failed. Try again.",
  NO_REFRESH: "Sign-in failed. Try again.",
  NOT_REMOTE: "Only a remote server can be signed in to.",
  UNKNOWN: "Something went wrong. Try again.",
};

function linkText(state: LinkState | undefined): string {
  if (!state || state.status === "disconnected") return "";
  if (state.status === "signin-needed") return "Sign in again to keep this server linked.";
  return state.localLinked
    ? "Signed in. This computer's server can use it."
    : "Signed in. Linked to this computer's server once it is running.";
}

const newest = (a: ServerEntry, b: ServerEntry) =>
  (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || a.name.localeCompare(b.name);

function row(server: ServerEntry): HTMLLIElement {
  const item = document.createElement("li");
  const info = document.createElement("div");
  info.className = "info";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = server.name;
  const origin = document.createElement("div");
  origin.className = "origin";
  origin.textContent = server.webOrigin;
  info.append(name, origin);
  const linkLine = document.createElement("div");
  linkLine.className = "origin";
  linkLine.textContent = linkText(links[server.id]);
  linkLine.hidden = !linkLine.textContent;
  if (server.kind === "remote") info.append(linkLine);

  const open = document.createElement("button");
  open.className = "primary";
  open.type = "button";
  open.textContent = "Open";
  open.addEventListener("click", () => void rpc.request.openServer({ id: server.id }));

  const remove = document.createElement("button");
  remove.className = "quiet";
  remove.type = "button";
  remove.textContent = "Remove";
  let armed: ReturnType<typeof setTimeout> | undefined;
  remove.addEventListener("click", () => {
    if (armed === undefined) {
      remove.textContent = "Confirm remove";
      armed = setTimeout(() => {
        armed = undefined;
        remove.textContent = "Remove";
      }, 4_000);
      return;
    }
    clearTimeout(armed);
    void rpc.request.removeServer({ id: server.id });
  });

  const connected = links[server.id] && links[server.id]!.status !== "disconnected";
  const link = document.createElement("button");
  link.className = "quiet";
  link.type = "button";
  link.textContent = !connected
    ? "Connect"
    : links[server.id]!.status === "signin-needed"
      ? "Sign in again"
      : "Disconnect";
  link.addEventListener("click", async () => {
    link.disabled = true;
    try {
      if (connected && links[server.id]!.status === "connected") {
        await rpc.request.disconnectRemote({ id: server.id });
      } else {
        say("Finish signing in in your browser...");
        const result = await rpc.request.connectRemote({ id: server.id });
        say(
          result.status === "connected"
            ? `Signed in to ${server.name}.`
            : linkProblems[result.error],
          result.status === "connected" ? "info" : "error",
        );
      }
      links = await rpc.request.linkStates({});
      render(lastServers);
    } finally {
      link.disabled = false;
    }
  });

  const sharingOn = share.states[server.id]?.enabled === true;
  const shareButton = document.createElement("button");
  shareButton.className = "quiet";
  shareButton.type = "button";
  shareButton.textContent = sharingOn ? "Stop sharing" : "Share this computer";
  shareButton.addEventListener("click", async () => {
    shareButton.disabled = true;
    try {
      const done = await rpc.request.shareComputer({ id: server.id, on: !sharingOn });
      if (!done) say("The server did not accept this computer. Try signing in again.", "error");
      else if (!sharingOn)
        say(`Bots of ${server.name} can now ask to use this computer. You decide each time.`);
      renderSharing(await rpc.request.sharing({}));
      render(lastServers);
    } finally {
      shareButton.disabled = false;
    }
  });
  const signedIn = links[server.id]?.status === "connected";

  item.append(
    info,
    open,
    ...(server.kind === "remote" ? [link] : []),
    ...(server.kind === "remote" && (signedIn || sharingOn) ? [shareButton] : []),
    remove,
  );
  return item;
}

let localEntry: ServerEntry | undefined;
let localNow: LocalState | null = null;

const localCard = byId<HTMLElement>("local");
const localText = byId<HTMLDivElement>("local-state");
const localOpen = byId<HTMLButtonElement>("local-open");
const localToggle = byId<HTMLButtonElement>("local-toggle");
const localLog = byId<HTMLButtonElement>("local-log");

const localProblems: Record<string, string> = {
  START_TIMEOUT: "It did not start in time.",
  CRASHED: "It stopped and could not be restarted.",
};

function renderLocal(state: LocalState | null) {
  localNow = state;
  localCard.hidden = state === null;
  if (!state) return;
  const text: Record<LocalState["status"], string> = {
    stopped: "Stopped",
    starting: "Starting... the first start takes a minute",
    running: state.origin ? `Running at ${state.origin}` : "Running",
    failed: state.error?.startsWith("MISSING_")
      ? "This build does not include the server."
      : (localProblems[state.error ?? ""] ?? "It could not start."),
  };
  localText.textContent = text[state.status];
  localText.className = state.status === "failed" ? "origin error" : "origin";
  localOpen.disabled = state.status !== "running" || !localEntry;
  const active = state.status === "starting" || state.status === "running";
  localToggle.textContent = active ? "Stop" : state.status === "failed" ? "Try again" : "Start";
}

function render(servers: ServerEntry[]) {
  lastServers = servers;
  localEntry = servers.find((server) => server.kind === "local");
  const others = servers.filter((server) => server.kind !== "local");
  list.replaceChildren(...[...others].sort(newest).map(row));
  empty.hidden = servers.length > 0;
  renderLocal(localNow);
}

localOpen.addEventListener("click", () => {
  if (localEntry) void rpc.request.openServer({ id: localEntry.id });
});
localToggle.addEventListener("click", async () => {
  const active = localNow?.status === "starting" || localNow?.status === "running";
  localToggle.disabled = true;
  try {
    renderLocal(active ? await rpc.request.stopLocal({}) : await rpc.request.startLocal({}));
  } finally {
    localToggle.disabled = false;
  }
});
localLog.addEventListener("click", () => void rpc.request.showLocalLog({}));

const rpc = Electroview.defineRPC<LauncherRpc>({
  handlers: {
    requests: {},
    messages: {
      serversChanged: render,
      localChanged: renderLocal,
      sharingChanged: renderSharing,
      linksChanged: (next) => {
        links = next;
        render(lastServers);
      },
      // A zetta://add link: fill the field, never add on its own. The person checks the address and presses the button.
      promptAdd: (value) => {
        address.value = value;
        address.focus();
        say(`Check this address, then press "Add server": ${value}`);
      },
    },
  },
});
new Electroview({ rpc });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = address.value.trim();
  if (!value) return;
  const button = form.querySelector("button")!;
  button.disabled = true;
  say("Checking the server...");
  try {
    const result = await rpc.request.addServer({ address: value });
    if (result.status === "added") {
      address.value = "";
      const shared = result.sharesCookiesWith;
      say(
        shared.length
          ? `Added ${result.server.name}. It is on the same host as ${shared.join(", ")}: signing in to one signs you out of the other.`
          : `Added ${result.server.name}.`,
      );
    } else {
      say(problems[result.status], "error");
    }
  } catch {
    say("Something went wrong. Try again.", "error");
  } finally {
    button.disabled = false;
  }
});

void Promise.all([
  rpc.request.linkStates({}),
  rpc.request.sharing({}),
  rpc.request.listServers({}),
]).then(([states, sharedNow, servers]) => {
  links = states;
  renderSharing(sharedNow);
  render(servers);
});
void rpc.request.localState({}).then(renderLocal);
