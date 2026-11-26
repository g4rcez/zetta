import { afterAll, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
// The bot picker's library builds `new Event("change")` from the global, and happy-dom only takes its own Event class.
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
afterAll(() => {
  globalThis.Event = realEvent;
});

type Sent = { method: string; path: string; body: unknown };
const sent: Sent[] = [];
const person = (userId: string, name: string, role: string, extra: object = {}) => ({
  userId,
  name,
  email: `${userId}@example.invalid`,
  avatar: null,
  title: "",
  role,
  isRoot: false,
  isYou: false,
  joinedAt: "2030-01-01T00:00:00.000Z",
  chief: null,
  ...extra,
});
const bot = (id: string, name: string, canEdit: boolean) => ({
  id,
  name,
  kind: "specialist",
  description: "",
  visibility: "team",
  canEdit,
  version: 1,
  onboarded: true,
  harness: "fixture",
});
const invitation = {
  invitationId: "inv-1",
  intendedEmail: "ana@example.invalid",
  createdAt: "2030-01-01T00:00:00.000Z",
  expiresAt: "2030-01-02T00:00:00.000Z",
  role: "admin",
  chief: { botId: "bot-mine", name: "Helper", avatar: null },
};
/** The agent accounts people connected, as an administrator is shown them: the engine and the kind, nothing else. */
let connected = [
  {
    userId: "mel",
    id: "acc-mel",
    engine: "claude-code",
    kind: "token",
    state: "active",
    use: "default",
  },
  {
    userId: "root",
    id: "acc-root",
    engine: "codex",
    kind: "login",
    state: "signed_out",
    use: "default",
  },
];
let me = "owner";
let pending = [invitation];
let people = [
  person("root", "Rita Root", "owner", { isRoot: true, isYou: true }),
  person("ana", "Ana Admin", "admin"),
  person("mel", "Mel Member", "member"),
  person("chi", "Chi Shared", "member", {
    chief: { botId: "bot-mine", name: "Helper", avatar: null, ownerUserId: "root" },
  }),
];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method !== "GET") {
    sent.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.pathname === "/api/identity/invitations/revoke") pending = [];
    if (url.pathname === "/api/identity/invitations")
      return Response.json(
        { invitationId: "inv-2", expiresAt: "2030-01-02T00:00:00.000Z", token: "t".repeat(43) },
        { status: 201 },
      );
    return Response.json({ invitationId: "inv-1" });
  }
  if (url.pathname === "/api/workspace/")
    return Response.json({
      workspace: { id: "w1", slug: "main", name: "Workspace" },
      role: me,
      isRoot: me === "owner",
    });
  if (url.pathname === "/api/workspace/members") return Response.json({ members: people });
  if (url.pathname === "/api/workspace/invitations") return Response.json({ invitations: pending });
  if (url.pathname === "/api/bots")
    return Response.json({
      bots: [bot("bot-mine", "Helper", true), bot("bot-theirs", "Not mine", false)],
    });
  if (url.pathname === "/api/engine-accounts/people") return Response.json({ accounts: connected });
  if (url.pathname === "/api/teams") return Response.json({ teams: [] });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));

async function mount(isAdmin: boolean) {
  (win.document.body as unknown as Element).replaceChildren();
  const { Invites } = await import("./invites");
  const host = win.document.createElement("div") as unknown as Element;
  (win.document.body as unknown as Element).append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Invites isAdmin={isAdmin} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { host, root };
}
const button = (host: Element, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLElement;
const selects = (host: Element) => [...host.querySelectorAll("select")] as HTMLSelectElement[];
/** The select whose label carries this text. */
const select = (host: Element, label: string) =>
  selects(host).find((s) =>
    (s.closest("label")?.textContent ?? s.getAttribute("title") ?? s.title ?? "").includes(label),
  ) ??
  selects(host).find((s) => (s.parentElement?.parentElement?.textContent ?? "").includes(label));
/** The choices of a select, without the empty first one the Select component adds by itself. */
const options = (s: HTMLSelectElement | undefined) =>
  [...(s?.options ?? [])].map((o) => o.value).filter(Boolean);
/** A real press, as the bot picker needs to open and to take a choice. */
const press = (el: unknown) =>
  act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      (el as Element).dispatchEvent(
        new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event,
      );
  });
/** The bot picker with this label: its text box. */
const picker = (host: Element, label: string) =>
  [...host.querySelectorAll('[role="combobox"]')].find((c) =>
    (c.closest("label")?.textContent ?? c.parentElement?.parentElement?.textContent ?? "").includes(
      label,
    ),
  ) as HTMLInputElement | undefined;
/** Opens a bot picker and returns the text of its choices. */
async function botChoices(box: HTMLInputElement) {
  await press(box);
  await settle();
  return [...win.document.querySelectorAll('[role="option"]')];
}
async function choose(s: HTMLSelectElement, value: string) {
  await act(async () => {
    s.value = value;
    s.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  });
  await settle();
}

beforeEach(() => {
  sent.length = 0;
  me = "owner";
  pending = [invitation];
});

test("an owner sees everyone with their role, and sets a member's role", async () => {
  const { host, root } = await mount(true);
  for (const name of ["Rita Root", "Ana Admin", "Mel Member", "Chi Shared"])
    expect(host.textContent).toContain(name);
  // Root stays an owner: no choice is offered on that row.
  expect(select(host, "Role of Rita Root")).toBeUndefined();
  expect(options(select(host, "Role of Mel Member"))).toEqual(["owner", "admin", "member"]);

  await choose(select(host, "Role of Mel Member")!, "admin");
  expect(sent).toEqual([
    { method: "PUT", path: "/api/workspace/members/mel/role", body: { role: "admin" } },
  ]);
  await act(async () => root.unmount());
});

test("an administrator moves people between member and administrator, and no owner", async () => {
  me = "admin";
  people = people.map((p) => ({ ...p, isYou: p.userId === "ana" }));
  const { host, root } = await mount(true);
  expect(options(select(host, "Role of Mel Member"))).toEqual(["admin", "member"]);
  expect(select(host, "Role of Rita Root")).toBeUndefined();
  // Not their own role either.
  expect(select(host, "Role of Ana Admin")).toBeUndefined();
  // And an invitation of theirs makes a member: there is no role to choose.
  expect(host.querySelector('select[name="role"]')).toBeNull();
  people = people.map((p) => ({ ...p, isYou: p.userId === "root" }));
  await act(async () => root.unmount());
});

test("a Chief that was shared is shown with its bot, and can be taken away", async () => {
  const { host, root } = await mount(true);
  expect(host.textContent).toContain("Shared with them as their Chief");
  await act(async () => button(host, "Take away").click());
  await act(async () => button(host, "Stop sharing").click());
  await settle();
  expect(sent).toEqual([
    { method: "DELETE", path: "/api/workspace/members/chi/chief", body: null },
  ]);
  await act(async () => root.unmount());
});

test("one of the person's own bots can be shared as someone's Chief; a bot of someone else is not offered", async () => {
  const { host, root } = await mount(true);
  // Nobody shares a Chief with themselves.
  expect(picker(host, "Chief of Rita Root")).toBeUndefined();
  const choices = await botChoices(picker(host, "Chief of Mel Member")!);
  // Each choice shows the bot with what it is for, and only the person's own bots are there.
  expect(choices.map((o) => o.textContent)).toEqual([expect.stringContaining("Helper")]);
  expect(choices[0]!.textContent).not.toBe("Helper");
  await press(choices[0]);
  await settle();
  // Picking a bot shares nothing yet: the button does.
  expect(sent).toEqual([]);
  await act(async () => button(host, "Share as their Chief").click());
  await settle();
  expect(sent).toEqual([
    { method: "PUT", path: "/api/workspace/members/mel/chief", body: { botId: "bot-mine" } },
  ]);
  await act(async () => root.unmount());
});

test("an owner's invitation can make an administrator and give one of their bots as the Chief", async () => {
  const { host, root } = await mount(true);
  const role = host.querySelector('select[name="role"]') as HTMLSelectElement;
  expect(options(role)).toEqual(["member", "admin"]);
  const choices = await botChoices(picker(host, "Their Chief")!);
  expect(choices.map((o) => o.textContent)).toEqual([expect.stringContaining("Helper")]);
  await press(choices[0]);
  await settle();
  // The form holds the bot's id, which is what the invitation sends.
  expect(
    (host.querySelector('input[type="hidden"][name="chiefBotId"]') as HTMLInputElement).value,
  ).toBe("bot-mine");
  expect(host.textContent).toContain("It stays yours");
  await act(async () => root.unmount());
});

test("each person's connected engines are listed, and an administrator can disconnect another person's", async () => {
  const { host, root } = await mount(true);
  const mels = host.querySelector('[aria-label="Agent accounts of Mel Member"]')!;
  expect(mels.textContent).toContain("Claude Code");
  expect(mels.textContent).toContain("Subscription token");
  // Their own account is listed too, with its state, and is disconnected on their own Accounts page.
  const mine = host.querySelector('[aria-label="Agent accounts of Rita Root"]')!;
  expect(mine.textContent).toContain("Codex");
  expect(mine.textContent).toContain("Signed out");
  expect(mine.querySelector("button")).toBeNull();
  // Someone with no account has no list.
  expect(host.querySelector('[aria-label="Agent accounts of Ana Admin"]')).toBeNull();
  await act(async () => (mels.querySelector("button") as HTMLElement).click());
  await act(async () =>
    (
      [...mels.querySelectorAll("button")].find(
        (b) => b.textContent === "Disconnect",
      ) as HTMLElement
    ).click(),
  );
  await settle();
  expect(sent).toEqual([
    { method: "DELETE", path: "/api/engine-accounts/people/mel/acc-mel", body: null },
  ]);
  await act(async () => root.unmount());
});

test("a pending invitation shows what it gives, and can be revoked", async () => {
  const { host, root } = await mount(true);
  expect(host.textContent).toContain("ana@example.invalid");
  expect(host.textContent).toContain("Will be their Chief");

  await act(async () => button(host, "Revoke").click());
  await act(async () => button(host, "Revoke invitation").click());
  await settle();

  expect(sent).toEqual([
    { method: "POST", path: "/api/identity/invitations/revoke", body: { invitationId: "inv-1" } },
  ]);
  expect(host.textContent).toContain("No pending invitations.");
  await act(async () => root.unmount());
});

test("someone who does not administer the workspace cannot invite", async () => {
  const { host, root } = await mount(false);
  expect(host.textContent).toContain(
    "Only an owner or an administrator of this workspace invites people.",
  );
  expect(host.querySelector("form")).toBeNull();
  await act(async () => root.unmount());
});
