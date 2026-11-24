import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const BOX = "00000000-0000-7000-8000-0000000000b1";
const OWNER = "00000000-0000-7000-8000-0000000000c1";
const CHIEF = "00000000-0000-7000-8000-0000000000c2";
const CHAT = "00000000-0000-7000-8000-0000000000d1";
const bot = (id: string, name: string, kind: "chief" | "specialist") => ({
  id,
  name,
  kind,
  avatar: null,
  description: "",
  visibility: "private",
});
const mailbox = (over: object = {}) => ({
  id: BOX,
  kind: "imap",
  address: "ana@example.invalid",
  label: "",
  state: "active",
  lastError: null,
  sending: "off",
  ownerBotId: null,
  servers: {},
  ...over,
});

let mailboxes: unknown[] = [mailbox()];
const requests: { method: string; path: string; body: unknown }[] = [];
const fakeFetch = (async (input: URL | string | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  requests.push({ method, path: url.pathname, body: raw ? JSON.parse(String(raw)) : undefined });
  const ok = (v: unknown) => Response.json(v);
  if (url.pathname === "/api/mailboxes") return ok({ mailboxes });
  if (url.pathname === "/api/bots")
    return ok({ bots: [bot(OWNER, "Mailer", "specialist"), bot(CHIEF, "Zetta", "chief")] });
  if (url.pathname === `/api/mailboxes/${BOX}/chat`) {
    const owner = (mailboxes[0] as { ownerBotId: string | null }).ownerBotId;
    return ok({
      chat: {
        conversationId: owner ? CHAT : `${CHAT.slice(0, -1)}2`,
        botId: owner ?? CHIEF,
        botKind: owner ? "specialist" : "chief",
      },
    });
  }
  if (url.pathname === `/api/mailboxes/${BOX}/conversations`) return ok({ conversations: [] });
  if (/\/conversations\/[^/]+$/.test(url.pathname) && url.pathname.includes("/mailboxes/"))
    return ok({
      conversation: { id: "conv1", subject: "Quarterly audit", messages: [] },
    });
  if (url.pathname.endsWith("/messages")) return ok({ messages: [] });
  if (url.pathname === "/api/proposals") return ok({ proposals: [] });
  if (url.pathname.endsWith("/chat") && method === "POST")
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  return ok({});
}) as typeof fetch;

// Bun runs the test files in one process, so this file takes `fetch` only while its own tests run.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = fakeFetch;
});
const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const u of mounted.splice(0)) await u();
  mailboxes = [mailbox()];
  requests.length = 0;
  win.happyDOM.setViewport({ width: 1024, height: 768 });
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));
const text = () => win.document.body.textContent ?? "";
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error(`nothing to click in: ${text()}`);
  await act(
    async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};
const button = (label: string) =>
  [...win.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
const chatPanel = () => win.document.querySelector('[aria-label="Chat"]');
const WIDE = { width: 1400, height: 900 };

type Search = import("./mail-search").MailSearch;
const mount = async (search: Search = {}, viewport = WIDE) => {
  win.happyDOM.setViewport(viewport);
  const { MailInboxPage } = await import("./mail-inbox-page");
  const { withMailSearch } = await import("./mail-search");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const changes: Search[] = [];
  const Page = () => (
    <MailInboxPage
      mailboxId={BOX}
      search={search}
      setSearch={(patch) => changes.push(withMailSearch(search, patch))}
    />
  );
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Page />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return { changes };
};
const sentBodies = () =>
  requests
    .filter((r) => r.method === "POST" && /\/api\/conversations\/[^/]+\/chat$/.test(r.path))
    .map((r) => r.body as Record<string, unknown>);

test("wide: the chat is the fourth column, open by default, and shows who answers", async () => {
  mailboxes = [mailbox({ ownerBotId: OWNER })];
  await mount({ c: "conv1" });
  const panel = chatPanel()!;
  expect(panel.tagName).toBe("ASIDE");
  expect(panel.textContent).toContain("Mailer");
  const settings = [...panel.querySelectorAll("a")].find(
    (a) => a.textContent === "Change who answers",
  );
  expect(settings?.getAttribute("href")).toBe(`/mail/${BOX}/settings`);
  // Asked once for the mailbox's chat, which is then shown.
  expect(requests.filter((r) => r.path === `/api/mailboxes/${BOX}/chat`)).toHaveLength(1);
  expect(requests.some((r) => r.path === `/api/conversations/${CHAT}/messages`)).toBe(true);
  expect(
    win.document.querySelector('[role="separator"][aria-label="Resize the chat"]'),
  ).not.toBeNull();
  // Open by default: the toggle is only for bringing it back, and closing leaves the address through `panel`.
  expect(button("Chat")).toBeUndefined();
});

test("with no owner bot, Zetta answers", async () => {
  await mount({ c: "conv1" });
  const panel = chatPanel()!;
  expect(panel.textContent).toContain("Zetta");
  expect(panel.textContent).not.toContain("Mailer");
});

test("an open conversation is named above the box and sent with each message", async () => {
  await mount({ c: "conv1" });
  expect(text()).toContain("Asking about:");
  expect(text()).toContain("“Quarterly audit”");
  await click(button("Summarise this conversation"));
  await click(win.document.querySelector('button[aria-label="Send"]'));
  const [body] = sentBodies();
  expect(body?.content).toBe("Summarise this conversation");
  expect(body?.context).toEqual({ kind: "mail", mailboxId: BOX, conversationId: "conv1" });
});

test("with no conversation open there is no line and no context is sent", async () => {
  await mount({});
  expect(text()).not.toContain("Asking about:");
  await click(button("Which conversations are waiting for an answer?"));
  await click(win.document.querySelector('button[aria-label="Send"]'));
  const [body] = sentBodies();
  expect(body?.content).toBe("Which conversations are waiting for an answer?");
  expect(body && "context" in body).toBe(false);
});

test("the examples fill the box and are never sent by themselves", async () => {
  await mount({ c: "conv1" });
  expect(text()).toContain("What does this person want from me?");
  expect(text()).toContain("Find mail about …");
  await click(button("What does this person want from me?"));
  expect(win.document.querySelector(".cm-content")?.textContent).toBe(
    "What does this person want from me?",
  );
  expect(sentBodies()).toHaveLength(0);
  // The sending example is only a start for the person to finish: it fills the box and sends nothing.
  await click(button("Reply that …"));
  expect(win.document.querySelector(".cm-content")?.textContent).toContain("Reply that …");
  expect(sentBodies()).toHaveLength(0);
});

test("the empty chat says the bot can answer mail when asked, and that what it wants to send itself asks first", async () => {
  await mount({ c: "conv1" });
  expect(text()).toContain("The bot can answer it when you ask");
  expect(text()).toContain("asks you first");
  expect(text().toLowerCase()).not.toContain("only reads");
  expect(text().toLowerCase()).not.toContain("sends nothing");
});

test("closing the chat writes panel=closed, and a closed chat brings its toggle", async () => {
  const first = await mount({});
  await click(win.document.querySelector('button[aria-label="Close the chat"]'));
  expect(first.changes.at(-1)).toEqual({ panel: "closed" });
  await mount({ panel: "closed" });
  expect(chatPanel()).toBeNull();
  const toggle = button("Chat")!;
  expect(toggle).toBeDefined();
  const second = await mount({ panel: "closed" });
  await click(button("Chat"));
  expect(second.changes.at(-1)).toEqual({});
});

test("narrow: no column; a toggle shows the chat in place of the conversation, with a way back", async () => {
  const narrow = { width: 800, height: 900 };
  const first = await mount({ c: "conv1" }, narrow);
  expect(chatPanel()).toBeNull();
  expect(requests.some((r) => r.path === `/api/mailboxes/${BOX}/chat`)).toBe(false);
  await click(button("Chat"));
  expect(first.changes.at(-1)).toEqual({ c: "conv1", panel: "focus" });
  const second = await mount({ c: "conv1", panel: "focus" }, narrow);
  const view = chatPanel()!;
  expect(view.tagName).toBe("SECTION");
  expect(view.textContent).toContain("Asking about:");
  expect(win.document.querySelector('section[aria-label="Conversation"]')?.className).toContain(
    "hidden",
  );
  await click(button("Back to mail"));
  expect(second.changes.at(-1)).toEqual({ c: "conv1" });
});

const lines = () =>
  [...win.document.querySelectorAll(".cm-content .cm-line")]
    .filter((l) => !l.querySelector(".cm-placeholder"))
    .map((l) => l.textContent);

test("an example fills an empty box whole, and one clicked over text goes after it on a new line; the box takes the focus", async () => {
  await mount({});
  await click(button("Find mail about …"));
  expect(lines()).toEqual(["Find mail about …"]);
  expect(win.document.activeElement?.closest(".cm-content")).not.toBeNull();
  await click(button("Which conversations are waiting for an answer?"));
  expect(lines()).toEqual(["Find mail about …", "Which conversations are waiting for an answer?"]);
  expect(sentBodies()).toHaveLength(0);
});

// The page decides from the width it has, not from the window: these are the window widths at which the app's sidebar leaves the
// page 1360 - 225 = 1135 px or the like. mail-layout.test.ts holds the table; this checks the page follows it.
const columnsAt = async (width: number, search: Search = { c: "conv1" }) => {
  await mount(search, { width, height: 900 });
  const has = (q: string) => win.document.querySelector(q) !== null;
  return {
    mailboxes: has('aside[aria-label="Your mailboxes"]'),
    menu: [...win.document.querySelectorAll("summary")].some((s) =>
      s.textContent?.startsWith("Mailbox:"),
    ),
    chat: has('aside[aria-label="Chat"]'),
    toggle: button("Chat") !== undefined,
  };
};

test("page arrangement follows the available width", async () => {
  expect(await columnsAt(1500)).toEqual({
    mailboxes: true,
    menu: false,
    chat: true,
    toggle: false,
  });
  // Four columns do not fit: the mailboxes become a menu in the list header, the chat stays a column.
  expect(await columnsAt(1200)).toEqual({
    mailboxes: false,
    menu: true,
    chat: true,
    toggle: false,
  });
  // Still not: the chat is no longer a column and a toggle takes its place.
  expect(await columnsAt(1100)).toEqual({
    mailboxes: true,
    menu: false,
    chat: false,
    toggle: true,
  });
  expect(await columnsAt(900)).toEqual({ mailboxes: false, menu: true, chat: false, toggle: true });
});
