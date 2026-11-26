import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { ENGINE_SIGN_IN } from "@zetta/core/engine-accounts";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const BOT = "00000000-0000-7000-8000-0000000000b1";
const account = (id: string, engine: string, label: string, more: object = {}) => ({
  id,
  engine,
  kind: "token",
  provider: null,
  label,
  use: "default",
  state: "active",
  checkedAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  ...more,
});
let accounts = [
  account("acc-claude", "claude-code", "Personal"),
  account("acc-claude-2", "claude-code", "Work", { use: "extra" }),
  account("acc-codex", "codex", "ChatGPT"),
  account("acc-gone", "codex", "Old", { state: "signed_out", use: "extra" }),
];
let choice: Record<string, unknown> = {};
const base = {
  botId: BOT,
  owner: false,
  ownerPays: false,
  default: { harness: "claude-code", model: null },
  harness: null,
  model: null,
  accountId: null,
  sharedAccount: "asker",
};
const sent: { method: string; path: string; body: Record<string, unknown> | null }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  if (method !== "GET") sent.push({ method, path: url.pathname, body });
  if (url.pathname === "/api/engine-accounts/")
    return Response.json({
      accounts,
      sealed: true,
      serverLogin: "allowed",
      methods: ENGINE_SIGN_IN,
    });
  if (url.pathname === `/api/engine-accounts/bots/${BOT}`) {
    if (method === "PUT") choice = { ...choice, ...body };
    return Response.json({ choice });
  }
  if (url.pathname === `/api/engine-accounts/bots/${BOT}/shared`) {
    choice = { ...choice, ...body };
    return Response.json({ botId: BOT, ...body });
  }
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";
/** The select whose label holds this text. */
const select = (label: string) =>
  [...win.document.querySelectorAll("select")].find((s) =>
    (s.closest("label")?.textContent ?? s.parentElement?.parentElement?.textContent ?? "").includes(
      label,
    ),
  ) as HTMLSelectElement | undefined;
/** The choices of a select, without the empty first one the Select component adds by itself. */
const options = (s: HTMLSelectElement | undefined) =>
  [...(s?.options ?? [])].map((o) => o.value).filter(Boolean);
async function choose(s: HTMLSelectElement, value: string) {
  await act(async () => {
    s.value = value;
    s.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  });
  await settle();
}
const save = () =>
  [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent === "Save",
  ) as HTMLButtonElement;

let root: ReturnType<typeof createRoot> | undefined;
async function mount() {
  const { BotEngineChoice } = await import("./bot-engine-choice");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { queryClient } = await import("@/lib/query-client");
  queryClient.clear();
  function Harness() {
    const [botId] = useState(BOT);
    return (
      <QueryClientProvider client={queryClient}>
        <BotEngineChoice botId={botId} />
      </QueryClientProvider>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const host = win.document.createElement("div") as unknown as Element;
  (win.document.body as unknown as Element).append(host);
  root = createRoot(host);
  await act(async () => root!.render(<RouterProvider router={router as never} />));
  await settle(120);
}
beforeEach(() => {
  choice = { ...base };
  sent.length = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  win.document.body.replaceChildren();
});

test("someone who is not the owner follows the bot's engine until they choose their own engine, model and account", async () => {
  await mount();
  expect(text()).toContain("This bot is someone else's.");
  const engine = select("Engine")!;
  expect(options(engine)[0]).toBe("bot");
  // Only engines that take an account: the offline test engine is not a choice here.
  expect(options(engine)).not.toContain("fixture");
  // On the bot's own engine the accounts offered are theirs for that engine, and a signed-out one is not offered.
  expect(options(select("Account"))).toEqual(["default", "acc-claude", "acc-claude-2"]);
  expect(select("Model")).toBeUndefined();
  expect(save().disabled).toBe(true);

  await choose(engine, "codex");
  expect(options(select("Account"))).toEqual(["default", "acc-codex"]);
  await choose(select("Model")!, "gpt-5");
  await choose(select("Account")!, "acc-codex");
  await act(async () => save().click());
  await settle();
  expect(sent).toEqual([
    {
      method: "PUT",
      path: `/api/engine-accounts/bots/${BOT}`,
      body: { harness: "codex", model: "gpt-5", accountId: "acc-codex" },
    },
  ]);
  // Who pays in a room is the owner's to set.
  expect(select("In a room")).toBeUndefined();
});

test("going back to the bot's own engine sends an empty choice", async () => {
  choice = { ...base, harness: "codex", model: "gpt-5", accountId: "acc-codex" };
  await mount();
  await choose(select("Engine")!, "bot");
  await act(async () => save().click());
  await settle();
  expect(sent.at(-1)?.body).toEqual({ harness: null, model: null, accountId: null });
});

test("with no account for the engine the page says so and links to where one is connected", async () => {
  accounts = accounts.filter((a) => a.engine !== "claude-code");
  await mount();
  expect(text()).toContain("You have no account for claude-code.");
  expect(win.document.querySelector('a[href="/studio/accounts"]')).not.toBeNull();
  accounts = [
    account("acc-claude", "claude-code", "Personal"),
    account("acc-claude-2", "claude-code", "Work", { use: "extra" }),
    account("acc-codex", "codex", "ChatGPT"),
    account("acc-gone", "codex", "Old", { state: "signed_out", use: "extra" }),
  ];
});

test("the owner chooses which of their accounts runs the bot, and whose account pays in a room", async () => {
  choice = { ...base, owner: true };
  await mount();
  expect(text()).toContain("Your account for this bot");
  // The engine is the bot's own setting, not a choice here.
  expect(select("Engine")).toBeUndefined();
  await choose(select("Account")!, "acc-claude-2");
  await choose(select("In a room")!, "owner_in_rooms");
  expect(text()).toContain("Their messages count against your limit.");
  await act(async () => save().click());
  await settle();
  expect(sent).toEqual([
    {
      method: "PUT",
      path: `/api/engine-accounts/bots/${BOT}`,
      body: { harness: null, model: null, accountId: "acc-claude-2" },
    },
    {
      method: "PUT",
      path: `/api/engine-accounts/bots/${BOT}/shared`,
      body: { sharedAccount: "owner_in_rooms" },
    },
  ]);
});

test("a Chief that was shared with the person says whose account runs it, and offers nothing to choose", async () => {
  choice = { ...base, ownerPays: true };
  await mount();
  expect(text()).toContain("It runs on its owner's engine and account");
  expect(win.document.querySelector("select")).toBeNull();
  expect(save()).toBeUndefined();
});
