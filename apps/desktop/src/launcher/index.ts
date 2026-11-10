import { Electroview } from "electrobun/view";
import type { ServerEntry } from "../bun/registry";
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

  item.append(info, open, remove);
  return item;
}

function render(servers: ServerEntry[]) {
  list.replaceChildren(...[...servers].sort(newest).map(row));
  empty.hidden = servers.length > 0;
}

const rpc = Electroview.defineRPC<LauncherRpc>({
  handlers: {
    requests: {},
    messages: {
      serversChanged: render,
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

void rpc.request.listServers({}).then(render);
