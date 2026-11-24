import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const BOX = "00000000-0000-7000-8000-0000000000b1";
const BOX2 = "00000000-0000-7000-8000-0000000000b2";
const BOT = "00000000-0000-7000-8000-0000000000c1";
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
const summary = (n: number, over: object = {}) => ({
  id: `conv${n}`,
  subject: `Subject ${n}`,
  participants: [{ name: "Rui", address: "rui@example.invalid" }],
  lastDate: new Date(Date.now() - 3_600_000).toISOString(),
  messageCount: 1,
  snippet: `Snippet ${n}`,
  attachments: "none",
  ...over,
});
const message = (over: object = {}) => ({
  id: "m1",
  origin: "received",
  from: { name: "Rui", address: "rui@example.invalid" },
  to: [{ name: "", address: "ana@example.invalid" }],
  cc: [],
  date: "2026-11-20T10:00:00Z",
  subject: "Hello",
  text: "Plain words",
  html: "",
  htmlSize: "ok",
  remoteImages: "none",
  attachments: [],
  source: "complete",
  ...over,
});

type Reply = unknown | { __status: number; code: string; message: string };
const fail = (status: number, code: string, message: string) => ({
  __status: status,
  code,
  message,
});
let mailboxes: unknown[] = [mailbox()];
let pages: Record<string, Reply> = {};
let conversation: (images: string) => Reply = () => ({
  conversation: { id: "conv1", subject: "Hello", messages: [message()] },
});
let attachment: Reply = new Blob(["x"]);
const calls: string[] = [];
let pending = false;

globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  const key = `${url.pathname}${url.search}`;
  calls.push(key);
  if (pending) return new Promise<Response>(() => {});
  const send = (r: Reply) =>
    r && typeof r === "object" && "__status" in (r as object)
      ? Response.json(
          {
            error: {
              code: (r as never as { code: string }).code,
              message: (r as never as { message: string }).message,
            },
          },
          { status: (r as never as { __status: number }).__status },
        )
      : r instanceof Blob
        ? new Response(r)
        : Response.json(r);
  if (url.pathname === "/api/mailboxes") return send({ mailboxes });
  if (url.pathname === "/api/bots")
    return send({ bots: [{ id: BOT, name: "Mailer", kind: "specialist", avatar: null }] });
  if (url.pathname.includes("/attachments/")) return send(attachment);
  if (/\/conversations\/[^/]+$/.test(url.pathname))
    return send(conversation(url.searchParams.get("images") ?? ""));
  if (url.pathname.endsWith("/conversations"))
    return send(pages[url.searchParams.get("cursor") ?? ""] ?? { conversations: [] });
  return send(fail(500, "TEST", key));
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  mailboxes = [mailbox()];
  pages = {};
  calls.length = 0;
  pending = false;
  conversation = () => ({ conversation: { id: "conv1", subject: "Hello", messages: [message()] } });
  attachment = new Blob(["x"]);
  win.happyDOM.setViewport({ width: 1024, height: 768 });
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
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

type Search = import("./mail-search").MailSearch;
const mount = async (search: Search = {}, id = BOX) => {
  const { MailInboxPage } = await import("./mail-inbox-page");
  const { withMailSearch } = await import("./mail-search");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const changes: Search[] = [];
  const Page = () => (
    <MailInboxPage
      mailboxId={id}
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
const frame = () => win.document.querySelector("iframe") as unknown as HTMLIFrameElement | null;

test("no mailbox yet: one sentence and the way to connect one", async () => {
  mailboxes = [];
  await mount();
  expect(text()).toContain("No mailbox yet");
  const link = [...win.document.querySelectorAll("a")].find(
    (a) => a.textContent === "Connect a mailbox",
  );
  expect(link?.getAttribute("href")).toBe("/mail/new");
});

test("while the mailboxes load there is a status, not a blank page", async () => {
  pending = true;
  await mount();
  expect(win.document.querySelector('[role="status"]')).not.toBeNull();
});

test("the inbox lists conversations with people, subject, snippet, count and an attachment mark, and the open one is marked", async () => {
  mailboxes = [
    mailbox({ ownerBotId: BOT, label: "Work" }),
    mailbox({ id: BOX2, address: "b@example.invalid", state: "needs_auth" }),
  ];
  pages[""] = { conversations: [summary(1, { messageCount: 3, attachments: "some" }), summary(2)] };
  await mount({ c: "conv2" });
  expect(text()).toContain("Subject 1");
  expect(text()).toContain("Snippet 1");
  expect(text()).toContain("Rui");
  expect(text()).toContain("1h ago");
  expect(text()).toContain("3 messages");
  expect(text()).toContain("Has attachments");
  const rows = [...win.document.querySelectorAll('ul[aria-label="Conversations"] a')];
  expect(rows).toHaveLength(2);
  expect(rows[1]!.getAttribute("aria-current")).toBe("true");
  expect(rows[0]!.getAttribute("aria-current")).toBeNull();
  expect(rows[0]!.getAttribute("href")).toContain("c=conv1");
  // Each mailbox is its own view, with its state; the owner bot is drawn as a bot.
  expect(text()).toContain("Work");
  expect(text()).toContain("Needs password");
  expect(text()).toContain("Mailer");
  expect(text()).toContain("Connect another mailbox");
});

test("an empty inbox, and a search with no result that can be cleared", async () => {
  await mount();
  expect(text()).toContain("The inbox is empty");
  await mount({ q: "invoice" });
  expect(text()).toContain("No conversation matches");
  expect(text()).toContain("invoice");
  expect(calls.some((c) => c.includes("conversations?q=invoice"))).toBe(true);
});

test("a search is written to the address on submit and clears together with the open conversation", async () => {
  pages[""] = { conversations: [summary(1)] };
  const { changes } = await mount({ c: "conv1", q: "old" });
  const input = win.document.querySelector('input[name="q"]') as unknown as HTMLInputElement;
  expect(input.value).toBe("old");
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "new words",
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await act(
    async () =>
      void win.document
        .querySelector('form[role="search"]')!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  expect(changes.at(-1)).toEqual({ q: "new words" });
  await click(win.document.querySelector('button[aria-label="Clear the search"]'));
  expect(changes.at(-1)).toEqual({});
});

test("older conversations load with the server's cursor", async () => {
  pages[""] = { conversations: [summary(1)], nextCursor: "next-1" };
  pages["next-1"] = { conversations: [summary(2)] };
  await mount();
  expect(text()).not.toContain("Subject 2");
  await click(button("Show older"));
  expect(text()).toContain("Subject 2");
  expect(calls.some((c) => c.includes("cursor=next-1"))).toBe(true);
  expect(button("Show older")).toBeUndefined();
});

test("an open conversation can go back to the list (the narrow drill-down)", async () => {
  pages[""] = { conversations: [summary(1)] };
  // Too narrow for the list and the conversation side by side (see mail-layout.ts).
  win.happyDOM.setViewport({ width: 700, height: 900 });
  await mount({ c: "conv1", q: "x" });
  const back = [...win.document.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("Back to conversations"),
  );
  expect(back).toBeDefined();
  expect(back!.getAttribute("href")).toContain("q=x");
  expect(back!.getAttribute("href")).not.toContain("c=");
  // The list and the conversation are both in the page; the layout classes show one of them on a narrow screen.
  expect(win.document.querySelector('section[aria-label="Conversations"]')!.className).toContain(
    "hidden",
  );
  expect(win.document.querySelector('section[aria-label="Conversation"]')!.className).toContain(
    "flex",
  );
});

test("with nothing open the conversation column asks for a pick and the list is the narrow view", async () => {
  pages[""] = { conversations: [summary(1)] };
  win.happyDOM.setViewport({ width: 700, height: 900 });
  await mount();
  expect(text()).toContain("Pick a conversation");
  expect(win.document.querySelector('section[aria-label="Conversation"]')!.className).toContain(
    "hidden",
  );
  expect(
    win.document.querySelector('section[aria-label="Conversations"]')!.className,
  ).not.toContain("hidden ");
});

test("a message with HTML is shown in a frame that cannot run scripts, with its own policy", async () => {
  conversation = () => ({
    conversation: {
      id: "conv1",
      subject: "Hi",
      messages: [message({ html: "<p>Rich <b>text</b></p>" })],
    },
  });
  await mount({ c: "conv1" });
  const f = frame()!;
  expect(f).not.toBeNull();
  const sandbox = f.getAttribute("sandbox")!;
  expect(sandbox).not.toContain("allow-scripts");
  expect(sandbox).toContain("allow-popups-to-escape-sandbox");
  const doc = f.getAttribute("srcdoc")!;
  expect(doc).toContain("Content-Security-Policy");
  expect(doc).toContain("img-src data:;");
  expect(doc).not.toContain("https:");
  expect(doc).toContain("<p>Rich <b>text</b></p>");
  expect(f.getAttribute("title")).toBe("Message from Rui");
  // The conversation is announced and its heading can take the focus.
  expect(win.document.querySelector("h2#conversation-title")!.getAttribute("tabindex")).toBe("-1");
  expect(text()).toContain("Conversation: Hi, 1 message");
});

test("removed images: the bar says so, and Load images asks again for this conversation only", async () => {
  conversation = (images) => ({
    conversation: {
      id: "conv1",
      subject: "Promo",
      messages: [
        message({
          html: images === "remote" ? '<img src="https://t.example.invalid/p.png">' : "<p>hi</p>",
          remoteImages: images === "remote" ? "shown" : "removed",
        }),
      ],
    },
  });
  await mount({ c: "conv1" });
  expect(text()).toContain("tells the sender this mail was opened");
  expect(frame()!.getAttribute("srcdoc")).not.toContain("https:");
  await click(button("Load images"));
  expect(calls.some((c) => c.includes("images=remote"))).toBe(true);
  expect(text()).not.toContain("tells the sender this mail was opened");
  expect(frame()!.getAttribute("srcdoc")).toContain("img-src data: https:;");
  // Opening the page again starts blocked: nothing was remembered.
  await mount({ c: "conv1" });
  expect(frame()!.getAttribute("srcdoc")).not.toContain("img-src data: https:");
});

test("a message with no HTML shows its text with line breaks and safe links only; too large HTML falls back to text with a note", async () => {
  conversation = () => ({
    conversation: {
      id: "conv1",
      subject: "Text",
      messages: [
        message({ text: "Line one\nSee https://site.example.invalid/a. And javascript:alert(1)" }),
        message({
          id: "m2",
          html: "<p>big</p>",
          htmlSize: "too_large",
          text: "The text of a big one",
        }),
        message({ id: "m3", text: "", source: "unreadable" }),
      ],
    },
  });
  await mount({ c: "conv1" });
  const link = win.document.querySelector('a[href="https://site.example.invalid/a"]')!;
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.getAttribute("rel")).toContain("noreferrer");
  expect(win.document.querySelector('a[href^="javascript"]')).toBeNull();
  expect(text()).toContain("Line one");
  expect(text()).toContain("The formatted version is too large to show");
  expect(text()).toContain("The text of a big one");
  expect(text()).toContain("This message could not be read.");
  expect(frame()).toBeNull();
});

test("attachments are chips that download, and a failed download says so next to the file", async () => {
  conversation = () => ({
    conversation: {
      id: "conv1",
      subject: "Files",
      messages: [
        message({
          attachments: [
            {
              id: "a1",
              fileName: "report.pdf",
              contentType: "application/pdf",
              size: 2048,
              disposition: "attachment",
            },
          ],
        }),
      ],
    },
  });
  const clicked: { name: string; href: string }[] = [];
  const realCreate = win.document.createElement.bind(win.document);
  const made: string[] = [];
  (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = (b: Blob) => (
    made.push(String(b.size)),
    "blob:test"
  );
  (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
  const proto = win.HTMLAnchorElement.prototype as unknown as { click(): void };
  const originalClick = proto.click;
  proto.click = function (this: HTMLAnchorElement) {
    clicked.push({ name: this.download, href: this.href });
  };
  void realCreate;
  await mount({ c: "conv1" });
  expect(text()).toContain("report.pdf");
  expect(text()).toContain("2 KB");
  await click(win.document.querySelector('ul[aria-label="Attachments"] button'));
  expect(calls.some((c) => c.endsWith("/attachments/a1"))).toBe(true);
  expect(clicked).toEqual([{ name: "report.pdf", href: "blob:test" }]);
  attachment = fail(500, "MAIL_ERROR", "The mail server refused to read the file.");
  await click(win.document.querySelector('ul[aria-label="Attachments"] button'));
  expect(text()).toContain(
    "report.pdf could not be downloaded. The mail server refused to read the file.",
  );
  proto.click = originalClick;
});

test("a refused password points to the settings", async () => {
  pages[""] = fail(422, "AUTH", "The mail server did not accept the password.");
  await mount();
  expect(text()).toContain("The mail server did not accept the password");
  const link = [...win.document.querySelectorAll("a")].find(
    (a) => a.textContent === "Change the password",
  );
  expect(link?.getAttribute("href")).toBe(`/mail/${BOX}/settings`);
});

test("a server that cannot be read shows its sentence and Retry reads again", async () => {
  pages[""] = fail(502, "UNREACHABLE", "The mail server could not be reached to read the inbox.");
  await mount();
  expect(text()).toContain("Could not read the inbox");
  expect(text()).toContain("The mail server could not be reached");
  pages[""] = { conversations: [summary(1)] };
  await click(button("Retry"));
  expect(text()).toContain("Subject 1");
});

test("too many requests: the server's sentence and Retry", async () => {
  pages[""] = fail(429, "RATE_LIMITED", "Too many requests. Wait a minute and try again.");
  await mount();
  expect(text()).toContain("Too many requests");
  expect(text()).toContain("Wait a minute");
  expect(button("Retry")).toBeDefined();
});

test("a conversation that can no longer be found says so and the list stays", async () => {
  pages[""] = { conversations: [summary(1)] };
  conversation = () => fail(404, "NOT_FOUND", "gone");
  await mount({ c: "conv1" });
  expect(text()).toContain("This conversation can no longer be found");
  expect(text()).toContain("Subject 1");
});

test("a mailbox that is not in the list says so", async () => {
  await mount({}, BOX2);
  expect(text()).toContain("This mailbox is not here");
});

test("the inbox has no way to write, reply, archive, delete, label or mark as read", async () => {
  pages[""] = { conversations: [summary(1)] };
  await mount({ c: "conv1" });
  for (const word of [
    "Compose",
    "Reply",
    "Forward",
    "Archive",
    "Delete",
    "Mark as",
    "Label",
    "Move to",
  ])
    expect(text()).not.toContain(word);
});

test("each message shows when it came, as a relative time that a keyboard can focus, with the date in the same element", async () => {
  conversation = () => ({
    conversation: {
      id: "conv1",
      subject: "Hello",
      messages: [message({ date: new Date(Date.now() - 2 * 3_600_000).toISOString() })],
    },
  });
  await mount({ c: "conv1" });
  const when = win.document.querySelector("article time");
  expect(when?.textContent).toBe("2h ago");
  expect(when?.getAttribute("datetime")).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(when?.getAttribute("tabindex")).toBe("0");
});
