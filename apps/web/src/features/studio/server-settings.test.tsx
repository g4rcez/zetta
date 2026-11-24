import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { SETTING_GROUPS, settingMeta, type SettingKey } from "@zetta/core/settings";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { SettingsSearch } from "./settings-filters";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });
// The library builds `new Event("change")` from the global, and happy-dom only takes its own Event class.
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  sharedClient.setDefaultOptions(previousDefaults);
  globalThis.Event = realEvent;
  globalThis.FormData = bunFormData;
});

const { queryClient: sharedClient } = await import("@/lib/query-client");
// A failed read is reported at once here, not retried.
const previousDefaults = sharedClient.getDefaultOptions();
sharedClient.setDefaultOptions({ queries: { ...previousDefaults.queries, retry: false } });

type Row = Record<string, unknown> & {
  key: string;
  value: unknown;
  source: string;
  group: string;
  label: string;
};
const meta = (key: SettingKey, value: unknown, source: string): Row =>
  ({ ...settingMeta(key), value, source }) as unknown as Row;
const defaults = (): Row[] => [
  meta("lightRuns", "off", "default"),
  meta("claudeLiveInput", "off", "installation"),
  meta("harnessMax", 4, "default"),
  meta("vmDrivers", ["cua"], "imported"),
  meta("mcpAllowlist", ["npx -y tool"], "installation"),
  meta("codeAccess", "off", "default"),
  // A text and a choice: the registry has none yet, so these are made up to prove the controls.
  {
    ...meta("lightRuns", "a", "default"),
    key: "pickOne",
    label: "Pick one",
    help: "A choice.",
    group: "chat",
    type: "choice",
    default: "a",
    options: ["a", "b"],
    sensitive: false,
  },
];
let settings: Row[] = defaults();
let refusal: { status: number; code: string; message: string } | undefined;
let listFails = false;
let installation: Record<string, unknown> = { updateCheck: "on" };
const reads: string[] = [];
const writes: { method: string; path: string; body: Record<string, unknown> | undefined }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method === "GET") {
    reads.push(url.pathname);
    if (listFails)
      return Response.json(
        { error: { code: "UNAVAILABLE", message: "Something went wrong. Please retry." } },
        { status: 500 },
      );
    if (url.pathname === "/api/settings")
      return Response.json({ groups: SETTING_GROUPS, settings });
    if (url.pathname === "/api/identity/status")
      return Response.json({ state: "active", userId: "u1", isAdmin: true });
    if (url.pathname === "/api/installation") return Response.json(installation);
    if (url.pathname === "/api/installation/version")
      return Response.json({
        build: null,
        state: "unknown",
        latest: null,
        changes: [],
        checkedAt: null,
        check: "on",
      });
    return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
  }
  writes.push({ method, path: url.pathname, body });
  if (url.pathname === "/api/installation") {
    installation = { ...installation, ...body };
    return Response.json(installation);
  }
  if (refusal)
    return Response.json(
      { error: { code: refusal.code, message: refusal.message } },
      { status: refusal.status },
    );
  const key = decodeURIComponent(url.pathname.split("/").pop()!);
  settings = settings.map((s) =>
    s.key !== key
      ? s
      : method === "PUT"
        ? { ...s, value: body!.value, source: "installation" }
        : { ...s, value: s.default, source: "default" },
  );
  return Response.json(settings.find((s) => s.key === key));
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  win.document.body.replaceChildren();
  settings = defaults();
  refusal = undefined;
  listFails = false;
  installation = { updateCheck: "on" };
  reads.length = 0;
  writes.length = 0;
});
const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

type SearchCall = { next: SettingsSearch; how: string };
async function mount(search: SettingsSearch = {}, admin = true) {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { ServerSettingsPage } = await import("./server-settings");
  const { queryClient } = await import("@/lib/query-client");
  queryClient.clear();
  const calls: SearchCall[] = [];
  function Harness() {
    const [current, setCurrent] = useState(search);
    return (
      <QueryClientProvider client={queryClient}>
        <ServerSettingsPage
          admin={admin}
          search={current}
          setSearch={(next, how) => {
            calls.push({ next, how });
            setCurrent(next);
          }}
        />
      </QueryClientProvider>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return { calls };
}

const text = () => win.document.body.textContent ?? "";
const row = (label: string) =>
  win.document.querySelector(`form[aria-label="${label}"]`) as unknown as HTMLFormElement;
const labels = () => [...win.document.querySelectorAll("form h4")].map((h) => h.textContent ?? "");
const button = (label: RegExp, within: ParentNode = win.document) =>
  [...within.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? "")) as
    | HTMLButtonElement
    | undefined;
const press = async (b: Element | undefined | null) => {
  if (!b) throw new Error(`nothing to press in: ${text()}`);
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      b.dispatchEvent(new win.MouseEvent(type, { bubbles: true, button: 0 }) as never);
  });
  await settle();
};
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | null;
async function type(name: string, value: string) {
  const el = field(name)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
}
async function choose(name: string, value: string) {
  const el = field(name) as unknown as HTMLSelectElement;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
}
async function tick(name: string) {
  await act(async () => void field(name)!.click());
}
const alerts = () =>
  [...win.document.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");

describe("who sees the page", () => {
  test("a member sees one sentence and nothing is asked of the server", async () => {
    await mount({}, false);
    expect(text()).toContain("Only administrators");
    expect(reads).toEqual([]);
    expect(win.document.querySelector("form")).toBeNull();
  });
  test("it says it is loading, then lists the settings", async () => {
    await mount();
    expect(text()).not.toContain("Loading");
    expect(labels()).toHaveLength(settings.length);
  });
  test("the header says it is the whole installation and shows nothing about organizations to pick", async () => {
    await mount();
    expect(text()).toContain("These apply to the whole installation.");
    expect(win.document.querySelector('[name="organization"]')).toBeNull();
  });
  test("a failure to load reads in words", async () => {
    listFails = true;
    await mount();
    expect(alerts()).toContain("Something went wrong");
    expect(win.document.querySelector("form[aria-label='Light background runs']")).toBeNull();
  });
});

describe("what a setting shows", () => {
  test("the settings are grouped by the registry's group names", async () => {
    await mount();
    const heads = [...win.document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(heads).toEqual([
      SETTING_GROUPS.chat,
      SETTING_GROUPS.integrations,
      SETTING_GROUPS.limits,
      SETTING_GROUPS.computers,
      SETTING_GROUPS.security,
    ]);
  });
  test("each setting names its source in words", async () => {
    await mount();
    expect(row("Light background runs").textContent).toContain("Now: Off. The default.");
    expect(row("Messages reach Claude Code while it works").textContent).toContain(
      "Set for the installation",
    );
    expect(text()).toContain("Imported from the environment when the server was upgraded");
  });
  test("reset to default is offered only where something is stored", async () => {
    await mount();
    expect(button(/^Reset to default$/, row("Light background runs"))).toBeUndefined();
    expect(
      button(/^Reset to default$/, row("Messages reach Claude Code while it works")),
    ).toBeDefined();
  });
  test("a security policy carries its warning, the others do not", async () => {
    await mount();
    expect(row("Bots may run code").textContent).toContain(
      "Security policy: changes apply at once to everyone.",
    );
    expect(row("Light background runs").textContent).not.toContain("Security policy");
  });
});

describe("saving each kind of control", () => {
  test("a switch sends 'on' and shows the new source", async () => {
    await mount();
    expect(button(/^Save$/, row("Light background runs"))!.disabled).toBe(true);
    await tick("lightRuns");
    await press(button(/^Save$/, row("Light background runs")));
    expect(writes).toEqual([
      { method: "PUT", path: "/api/settings/lightRuns", body: { value: "on" } },
    ]);
    expect(row("Light background runs").textContent).toContain("Now: On. Set for the installation");
    expect(row("Light background runs").textContent).toContain("Saved.");
  });
  test("a number sends a number", async () => {
    await mount();
    await type("harnessMax", "7");
    await press(button(/^Save$/, row("Bot runs at once, in total")));
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/settings/harnessMax",
      body: { value: 7 },
    });
    expect(row("Bot runs at once, in total").textContent).toContain("Set for the installation");
  });
  test("a list with options sends the ticked names", async () => {
    await mount();
    await tick("vmDrivers:agent-desktop");
    await press(button(/^Save$/, row("What can drive a computer")));
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/settings/vmDrivers",
      body: { value: ["cua", "agent-desktop"] },
    });
  });
  test("a free list adds and removes entries", async () => {
    await mount();
    await type("mcpAllowlist.new", "uvx other");
    await press(button(/^Add entry$/));
    await press(button(/^Remove entry 1$/));
    await press(button(/^Save$/, row("Allowed local MCP commands")));
    await press(button(/^Save for everyone$/));
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/settings/mcpAllowlist",
      body: { value: ["uvx other"] },
    });
  });
  test("a choice sends the chosen option", async () => {
    await mount();
    await choose("pickOne", "b");
    await press(button(/^Save$/, row("Pick one")));
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/settings/pickOne",
      body: { value: "b" },
    });
  });
});

describe("reset, confirmation and errors", () => {
  test("reset to default sends a delete and shows the default again", async () => {
    await mount();
    await press(button(/^Reset to default$/, row("Messages reach Claude Code while it works")));
    expect(writes).toEqual([
      { method: "DELETE", path: "/api/settings/claudeLiveInput", body: undefined },
    ]);
    expect(row("Messages reach Claude Code while it works").textContent).toContain(
      "Back to the default.",
    );
    expect(row("Messages reach Claude Code while it works").textContent).toContain("The default");
  });
  test("a security policy asks first, and Cancel sends nothing", async () => {
    await mount();
    await tick("codeAccess");
    await press(button(/^Save$/, row("Bots may run code")));
    expect(writes).toEqual([]);
    expect(text()).toContain("applies at once to everyone on this server. Save it?");
    await press(button(/^Cancel$/));
    expect(writes).toEqual([]);
    await press(button(/^Save$/, row("Bots may run code")));
    await press(button(/^Save for everyone$/));
    expect(writes).toEqual([
      { method: "PUT", path: "/api/settings/codeAccess", body: { value: "on" } },
    ]);
  });
  test("the server's plain error is shown next to the field and nothing changes", async () => {
    refusal = { status: 400, code: "INVALID_REQUEST", message: "Use a number from 1 to 64." };
    await mount();
    await type("harnessMax", "900");
    await press(button(/^Save$/, row("Bot runs at once, in total")));
    // The library's own field also has an (empty) alert slot, so the page's sentence is the one that has text.
    const said = [...row("Bot runs at once, in total").querySelectorAll('[role="alert"]')]
      .map((a) => a.textContent)
      .filter(Boolean);
    expect(said).toEqual(["Use a number from 1 to 64."]);
    expect(field("harnessMax")!.value).toBe("900");
  });
});

describe("filters in the address", () => {
  test("a group in the address shows only its settings, with no click", async () => {
    await mount({ group: "limits" });
    expect(labels()).toEqual(["Bot runs at once, in total"]);
    expect((field("group") as unknown as HTMLSelectElement).value).toBe("limits");
    expect(text()).toContain("1 of 7 settings");
  });
  test("only changed hides the defaults", async () => {
    await mount({ show: "changed" });
    expect(labels()).not.toContain("Light background runs");
    expect(labels()).toContain("What can drive a computer");
    expect((field("show") as unknown as HTMLSelectElement).value).toBe("changed");
  });
  test("a text in the address", async () => {
    await mount({ q: "background" });
    expect(labels()).toEqual(["Light background runs"]);
    expect((field("q") as unknown as HTMLInputElement).value).toBe("background");
  });
  test("nothing matches: a sentence and a way back", async () => {
    await mount({ q: "zzzz" });
    expect(text()).toContain("No setting matches");
    expect(win.document.querySelector("a[href='/studio/settings']")).not.toBeNull();
  });
  test("choosing a filter writes it to the address; typing replaces; all drops it", async () => {
    const { calls } = await mount({ q: "a" });
    await choose("group", "chat");
    expect(calls.at(-1)).toEqual({ next: { q: "a", group: "chat" }, how: "push" });
    await choose("show", "changed");
    expect(calls.at(-1)).toEqual({ next: { q: "a", group: "chat", show: "changed" }, how: "push" });
    await choose("group", "all");
    expect(calls.at(-1)).toEqual({ next: { q: "a", show: "changed" }, how: "push" });
    await type("q", "zet");
    expect(calls.at(-1)).toEqual({ next: { show: "changed", q: "zet" }, how: "replace" });
    await choose("show", "all");
    expect(calls.at(-1)).toEqual({ next: { q: "zet" }, how: "push" });
  });
});

describe("the Updates card", () => {
  test("sits above the settings of the registry and carries the daily check", async () => {
    await mount();
    const card = win.document.querySelector('section[aria-label="Updates"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Check for updates");
    const filters = win.document.querySelector('form[aria-label="Filter the settings"]')!;
    // The card comes before the filters, which come before the first group.
    expect(card.compareDocumentPosition(filters as never) & 4).toBeTruthy();
  });
  test("the switch saves at once, for the whole installation", async () => {
    await mount();
    const box = win.document.querySelector(
      'section[aria-label="Updates"] input[type="checkbox"]',
    ) as unknown as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => void box.click());
    await settle();
    expect(writes).toEqual([
      { method: "PATCH", path: "/api/installation", body: { updateCheck: "off" } },
    ]);
  });
  test("a member sees no card and nothing is asked", async () => {
    await mount({}, false);
    expect(win.document.querySelector('section[aria-label="Updates"]')).toBeNull();
    expect(reads).toEqual([]);
  });
});
