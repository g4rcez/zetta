import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { ENGINE_SIGN_IN } from "@zetta/core/engine-accounts";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
// Bun's own FormData cannot read a DOM form; the page uses the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const pair = await generateTransportKeyPair();
const SECRET = "sk-ant-oat01-fake-token-for-test-only";
type Account = Record<string, unknown> & { id: string; engine: string };
const account = (id: string, engine: string, more: object = {}): Account => ({
  id,
  engine,
  kind: "token",
  provider: null,
  label: "Subscription",
  use: "default",
  state: "active",
  checkedAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  ...more,
});
let accounts: Account[] = [];
let serverLogin = "allowed";
let sealed = true;
/** The accounts connected for the whole workspace, and whether this person may connect one. */
let shared: Account[] = [];
let admin = false;
/** What the engine says when a signed-out account is tried again. */
let checked = "active";
/** What the server says of the sign-in that is running. */
let signIn: Record<string, unknown> | undefined;
const sent: { method: string; path: string; body: Record<string, unknown> | null }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  const path = url.pathname;
  if (method !== "GET") sent.push({ method, path, body });
  if (path === "/api/connections/transport-key")
    return Response.json({
      kid: "k1",
      publicKey: pair.publicKey,
      userId: "me",
      serverTime: Date.now(),
    });
  if (path === "/api/engine-accounts/" && method === "GET")
    return Response.json({
      accounts,
      sealed,
      serverLogin,
      methods: ENGINE_SIGN_IN,
      workspace: shared,
      mayConnectForWorkspace: admin,
    });
  if (path === "/api/engine-accounts/" && method === "POST") {
    const made = account("acc-new", String(body?.engine), {
      kind: body?.method === "api_key" ? "api_key" : "token",
      provider: body?.provider ?? null,
    });
    accounts = [...accounts, made];
    return Response.json({ account: made }, { status: 201 });
  }
  if (path === "/api/engine-accounts/sign-in" && method === "POST") {
    signIn = {
      id: "s1",
      engine: body?.engine,
      method: body?.method,
      state: "starting",
      url: null,
      code: null,
      input: "none",
      message: null,
      accountId: null,
    };
    return Response.json({ signIn }, { status: 201 });
  }
  if (path === "/api/engine-accounts/sign-in/s1" && method === "GET")
    return Response.json({ signIn });
  if (path === "/api/engine-accounts/sign-in/s1/input") return Response.json({ signIn });
  if (path.endsWith("/check")) {
    accounts = accounts.map((a) => (path.includes(a.id) ? { ...a, state: checked } : a));
    return Response.json({ account: accounts.find((a) => path.includes(a.id)) });
  }
  if (path.startsWith("/api/engine-accounts/") && method === "DELETE") {
    accounts = accounts.filter((a) => !path.endsWith(`/${a.id}`));
    return Response.json({ id: "gone" });
  }
  if (path.endsWith("/default")) {
    accounts = accounts.map((a) => ({ ...a, use: path.includes(a.id) ? "default" : "extra" }));
    return Response.json({ account: {} });
  }
  return Response.json({ error: { code: "TEST", message: `${method} ${path}` } }, { status: 500 });
}) as typeof fetch;

const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";
const button = (label: RegExp | string) =>
  [...win.document.querySelectorAll("button")].find((b) =>
    typeof label === "string"
      ? b.textContent?.trim() === label
      : label.test(b.textContent?.trim() ?? ""),
  ) as HTMLButtonElement | undefined;
const click = async (b: HTMLElement | undefined) => {
  await act(async () => b!.click());
  await settle();
};
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
const fill = (name: string, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      field(name),
      value,
    );
  });
const submit = async () => {
  await act(async () => {
    win.document
      .querySelector("form")!
      .dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
      );
  });
  await settle(120);
};

/**
 * The page asks the server about a running sign-in every second and a half. The query library decides once, when it is loaded, whether
 * it runs in a browser, and here it was loaded before the test's window existed, so its timer never starts: this asks in its place.
 */
async function poll() {
  const { queryClient } = await import("@/lib/query-client");
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ["engine-accounts", "sign-in"] });
  });
  await settle();
}
let root: ReturnType<typeof createRoot> | undefined;
async function mount(engine: string, label: string) {
  const { EngineAccountArea } = await import("./agent-accounts");
  const { queryClient } = await import("@/lib/query-client");
  queryClient.clear();
  const host = win.document.createElement("div") as unknown as Element;
  (win.document.body as unknown as Element).append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <EngineAccountArea engine={engine} label={label} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}
beforeEach(() => {
  accounts = [];
  serverLogin = "allowed";
  sealed = true;
  shared = [];
  admin = false;
  checked = "active";
  signIn = undefined;
  sent.length = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  win.document.body.replaceChildren();
});

test("with no account the page says whose sign-in runs the bots, and offers the engine's own ways to connect", async () => {
  await mount("claude-code", "Claude Code");
  expect(text()).toContain(
    "Your bots run on the server's own sign-in, which everyone here shares.",
  );
  await click(button("Connect my account"));
  for (const way of ["Sign in with your Claude subscription", "Paste a token", "Paste an API key"])
    expect(button(way)).toBeDefined();
  expect(text()).toContain("Choose how you want to connect.");
});

test("where the server runs bots only on an account, the page says to connect one", async () => {
  serverLogin = "off";
  await mount("pi", "Pi");
  expect(text()).toContain("this server runs bots only on an account");
});

test("a pasted token is sealed before it is sent, never left in the field, and the account appears", async () => {
  await mount("claude-code", "Claude Code");
  await click(button("Connect my account"));
  await click(button("Paste a token"));
  expect(field("secret").type).toBe("password");
  // One provider for this engine's key, and none at all for a token: nothing to choose.
  expect(field("provider")).toBeNull();
  await fill("secret", SECRET);
  await fill("label", "Mine");
  await submit();
  const posted = sent.find((s) => s.path === "/api/engine-accounts/" && s.method === "POST")!;
  expect(posted.body).toMatchObject({ engine: "claude-code", method: "token", label: "Mine" });
  expect(JSON.stringify(posted.body)).not.toContain(SECRET);
  expect(
    await open(
      pair.privateKey,
      posted.body!.sealed as never,
      { userId: "me", purpose: "engine-account.create:claude-code" },
      Date.now(),
    ),
  ).toEqual({ secret: SECRET });
  expect(text()).not.toContain(SECRET);
  expect(win.document.querySelector('[name="secret"]')).toBeNull();
  expect(
    win.document.querySelector('[aria-label="Your Claude Code accounts"]')?.textContent,
  ).toContain("Subscription");
});

test("a key asks whose it is only when the engine takes several", async () => {
  await mount("omp", "OMP");
  await click(button("Connect my account"));
  await click(button("Paste an API key"));
  const whose = field("provider") as unknown as HTMLSelectElement;
  expect([...whose.options].map((o) => o.value).filter(Boolean)).toEqual([
    "anthropic",
    "openai",
    "google",
    "openrouter",
    "deepseek",
  ]);
  await fill("secret", "sk-openrouter-fake-key");
  await submit();
  expect(sent.find((s) => s.method === "POST")?.body).toMatchObject({
    engine: "omp",
    method: "api_key",
    provider: "anthropic",
  });
});

test("a server that cannot store a secret says so and shows no field", async () => {
  sealed = false;
  await mount("pi", "Pi");
  await click(button("Connect my account"));
  expect(text()).toContain("cannot store a token or a key yet");
  expect(win.document.querySelector('[name="secret"]')).toBeNull();
});

test("a guided sign-in shows the engine's own link and code, and notices by itself when it is done", async () => {
  await mount("codex", "Codex");
  await click(button("Connect my account"));
  await click(button("Sign in with your ChatGPT plan"));
  await click(button("Start sign-in"));
  expect(sent.at(-1)).toMatchObject({
    path: "/api/engine-accounts/sign-in",
    body: { engine: "codex", method: "subscription" },
  });
  expect(text()).toContain("Starting the sign-in on the server");
  signIn = {
    ...signIn,
    state: "waiting",
    url: "https://auth.openai.com/codex/device",
    code: "AB12-CD345",
  };
  await poll();
  const link = win.document.querySelector(
    'a[href="https://auth.openai.com/codex/device"]',
  ) as HTMLAnchorElement;
  expect(link.target).toBe("_blank");
  expect(link.rel).toContain("noopener");
  expect(text()).toContain("AB12-CD345");
  // Codex finishes by itself: there is nothing to paste.
  expect(win.document.querySelector('[name="code"]')).toBeNull();
  accounts = [account("acc-codex", "codex", { kind: "login", label: "Subscription" })];
  signIn = { ...signIn, state: "done", accountId: "acc-codex" };
  await poll();
  expect(win.document.querySelector('[aria-label="Your Codex accounts"]')?.textContent).toContain(
    "Signed in",
  );
  expect(button("Start sign-in")).toBeUndefined();
});

test("a sign-in that takes a code passes on what the person pastes, and a failed one can be started again", async () => {
  await mount("claude-code", "Claude Code");
  await click(button("Connect my account"));
  await click(button("Sign in with your Claude subscription"));
  await click(button("Start sign-in"));
  signIn = {
    ...signIn,
    state: "waiting",
    url: "https://claude.ai/oauth/authorize?abc",
    input: "code",
  };
  await poll();
  await fill("code", "  the-code#state ");
  await submit();
  expect(sent.at(-1)).toMatchObject({
    path: "/api/engine-accounts/sign-in/s1/input",
    body: { text: "the-code#state" },
  });
  signIn = { ...signIn, state: "failed", message: "The sign-in took too long. Start it again." };
  await poll();
  expect(text()).toContain("The sign-in took too long. Start it again.");
  expect(button("Start again")).toBeDefined();
});

test("with several accounts the one in use is marked, another can take over, and one can be disconnected", async () => {
  accounts = [
    account("a1", "claude-code", { label: "Personal" }),
    account("a2", "claude-code", {
      label: "Work key",
      kind: "api_key",
      provider: "anthropic",
      use: "extra",
    }),
    account("other", "codex", { label: "Not this engine" }),
  ];
  await mount("claude-code", "Claude Code");
  const rows = () =>
    [...win.document.querySelectorAll('[aria-label="Your Claude Code accounts"] li')].map(
      (li) => li.textContent ?? "",
    );
  expect(rows()).toHaveLength(2);
  expect(rows()[0]).toContain("PersonalSubscription tokenIn use");
  expect(rows()[1]).toContain("Work keyAnthropic key");
  expect(text()).not.toContain("Not this engine");
  await click(button("Use this one"));
  expect(sent.at(-1)).toMatchObject({ method: "PUT", path: "/api/engine-accounts/a2/default" });
  expect(rows()[1]).toContain("In use");
  await click(
    [...win.document.querySelectorAll("button")].filter(
      (b) => b.textContent === "Disconnect",
    )[0] as HTMLElement,
  );
  // The first account's Disconnect asks first; its confirm button takes the same place.
  const disconnect = () =>
    win.document
      .querySelector('[aria-label="Your Claude Code accounts"] li')!
      .querySelectorAll("button");
  await click([...disconnect()].find((b) => b.textContent === "Disconnect") as HTMLElement);
  await click([...disconnect()].find((b) => b.textContent === "Disconnect") as HTMLElement);
  expect(sent.at(-1)).toMatchObject({ method: "DELETE", path: "/api/engine-accounts/a1" });
  expect(rows()).toHaveLength(1);
});

test("a sign-in the engine says is gone is marked, says why, and goes back to work once it is tried again and holds", async () => {
  accounts = [account("gone", "codex", { kind: "login", label: "ChatGPT", state: "signed_out" })];
  await mount("codex", "Codex");
  const row = () =>
    win.document.querySelector('[aria-label="Your Codex accounts"] li')!.textContent ?? "";
  expect(row()).toContain("Signed out");
  expect(row()).toContain("The engine says this sign-in is gone, so your bots do not run on it.");
  // Not signed in yet: it stays marked.
  checked = "signed_out";
  await click(button("Try again"));
  expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/engine-accounts/gone/check" });
  expect(row()).toContain("Signed out");
  checked = "active";
  await click(button("Try again"));
  expect(row()).not.toContain("Signed out");
  expect(button("Try again")).toBeUndefined();
});

test("the workspace's account is shown to everyone, covers whoever has none, and only an administrator connects or disconnects it", async () => {
  shared = [
    account("ws-acc", "claude-code", { kind: "api_key", provider: "anthropic", use: "workspace" }),
  ];
  await mount("claude-code", "Claude Code");
  expect(text()).toContain("No account of yours. Your bots run on the workspace's account.");
  const row = win.document.querySelector('[aria-label="The workspace\'s Claude Code account"]')!;
  expect(row.textContent).toContain("Anthropic key");
  expect(row.querySelector("button")).toBeNull();
  expect(button("Connect one for the workspace")).toBeUndefined();
});

test("an administrator connects a key for the whole workspace: it is sealed like any other and says whom it is for", async () => {
  admin = true;
  await mount("pi", "Pi");
  await click(button("Connect one for the workspace"));
  expect(text()).toContain("For the whole workspace");
  await fill("secret", SECRET);
  await submit();
  const posted = sent.find((s) => s.path === "/api/engine-accounts/" && s.method === "POST")!;
  expect(posted.body).toMatchObject({ engine: "pi", for: "workspace" });
  expect(JSON.stringify(posted.body)).not.toContain(SECRET);
});
