import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const BOX = "00000000-0000-7000-8000-0000000000b1";
const BOT = "00000000-0000-7000-8000-0000000000c1";
const ADDRESS = "helper-1a2b@bots.example.invalid";
const mailbox = (over: object = {}) => ({
  id: BOX,
  kind: "provisioned",
  address: ADDRESS,
  label: "Helper",
  state: "active",
  lastError: null,
  sending: "on",
  ownerBotId: BOT,
  allowedSenders: ["ana@example.invalid"],
  servers: {},
  ...over,
});
const bot = (over: object = {}) => ({
  id: BOT,
  name: "Helper",
  kind: "specialist",
  avatar: null,
  canEdit: true,
  ...over,
});

let mailboxes: unknown[] = [mailbox()];
let offer: { on: boolean; domain: string } = { on: true, domain: "bots.example.invalid" };
const writes: { method: string; path: string; body: Record<string, any> }[] = [];
let refusal: { status: number; code: string; message: string } | undefined;

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (url.pathname === "/api/mailboxes" && method === "GET") return Response.json({ mailboxes });
  if (url.pathname === "/api/mail/provisioning") return Response.json(offer);
  if (url.pathname === "/api/bots") return Response.json({ bots: [bot()] });
  if (method !== "GET") {
    writes.push({ method, path: url.pathname, body });
    if (refusal)
      return Response.json(
        { error: { code: refusal.code, message: refusal.message } },
        { status: refusal.status },
      );
    if (method === "DELETE") return Response.json({ ok: true });
    if (url.pathname === "/api/mailboxes/provision")
      return Response.json({ mailbox: mailbox({ allowedSenders: [] }) }, { status: 201 });
    return Response.json({ mailbox: mailbox(body) });
  }
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  mailboxes = [mailbox()];
  offer = { on: true, domain: "bots.example.invalid" };
  refusal = undefined;
  writes.length = 0;
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";
const mount = async (page: () => Promise<ReactNode>) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const node = await page();
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {node}
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
  return router;
};
const settings = () =>
  mount(async () => {
    const { MailSettingsPage } = await import("./mail-settings-page");
    return <MailSettingsPage mailboxId={BOX} />;
  });
const section = (b: object = bot()) =>
  mount(async () => {
    const { BotAddressSection } = await import("./bot-address-section");
    return <BotAddressSection bot={b as never} />;
  });
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | null;
const press = async (label: string) => {
  const b = [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const submit = async (label: string) => {
  await act(
    async () =>
      void win.document
        .querySelector(`form[aria-label="${label}"]`)!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();
};
const typeInto = async (name: string, value: string) => {
  const el = field(name)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
    el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
};

test("the settings of a bot's address hide the servers and the password, and show who may write to it", async () => {
  await settings();
  expect(text()).toContain(ADDRESS);
  expect(field("imapHost")).toBeNull();
  expect(field("smtpHost")).toBeNull();
  expect(field("password")).toBeNull();
  expect(field("allowedSenders")!.value).toBe("ana@example.invalid");
  expect(text()).toContain("made for the bot by this server");
  // The owner is the bot: no choice of who answers.
  expect(win.document.querySelector('input[name="owner"]')).toBeNull();
  expect(text()).toContain("Who answers this mailbox");
});

test("saving the allowed senders sends the list, split on commas and spaces", async () => {
  await settings();
  await typeInto(
    "allowedSenders",
    "bob@example.invalid, @partner.example.invalid  carol@example.invalid",
  );
  await submit("Who may write to it");
  expect(writes).toEqual([
    {
      method: "PATCH",
      path: `/api/mailboxes/${BOX}`,
      body: {
        allowedSenders: [
          "bob@example.invalid",
          "@partner.example.invalid",
          "carol@example.invalid",
        ],
      },
    },
  ]);
  expect(text()).toContain("Saved.");
});

test("a refused list shows the server's sentence", async () => {
  refusal = {
    status: 400,
    code: "BAD_INPUT",
    message: "Allowed senders are addresses (ana@example.com) or domains (@example.com).",
  };
  await settings();
  await typeInto("allowedSenders", "not an address");
  await submit("Who may write to it");
  expect(text()).toContain("Allowed senders are addresses");
});

test("the general form of a bot's address never sends an owner", async () => {
  await settings();
  await submit("General");
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body).toEqual({ label: "Helper", sending: "on" });
  expect("botId" in writes[0]!.body).toBe(false);
});

test("removing it says its mail is deleted and the address is never given out again", async () => {
  await settings();
  expect(text()).toContain("never given to anyone again");
  await press("Remove mailbox");
  expect(text()).toContain("Every message stored for it is deleted");
});

test("a retired address says so and keeps what was stored", async () => {
  mailboxes = [mailbox({ state: "retired" })];
  await settings();
  expect(text()).toContain("this address is retired");
});

test("the field is only for a bot's own address: an IMAP mailbox has servers and no senders", async () => {
  mailboxes = [
    mailbox({
      kind: "imap",
      address: "ana@example.invalid",
      allowedSenders: [],
      servers: {
        imapHost: "imap.example.invalid",
        imapPort: 993,
        smtpHost: "smtp.example.invalid",
        smtpPort: 465,
        user: "ana@example.invalid",
      },
    }),
  ];
  await settings();
  expect(field("allowedSenders")).toBeNull();
  expect(field("imapHost")).not.toBeNull();
  expect(field("password")).not.toBeNull();
});

test("bot settings show the address with a copy button that copies it", async () => {
  const copied: string[] = [];
  Object.defineProperty(win.navigator, "clipboard", {
    value: { writeText: async (t: string) => void copied.push(t) },
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
  await section();
  expect(text()).toContain(ADDRESS);
  expect(text()).toContain("answers mail from ana@example.invalid");
  expect(text()).not.toContain("Give this bot an address");
  await press("Copy address");
  expect(copied).toEqual([ADDRESS]);
  expect(text()).toContain("Copied");
  const links = [...win.document.querySelectorAll("a")].map((a) => a.textContent);
  expect(links).toContain("Open the inbox");
  expect(links).toContain("Who may write to it");
});

test("a bot nobody may write to says the bot answers nobody yet", async () => {
  mailboxes = [mailbox({ allowedSenders: [] })];
  await section();
  expect(text()).toContain("Nobody is allowed to write to Helper yet");
});

test("a bot with no address is offered one when the server hands them out, and the click makes it", async () => {
  mailboxes = [];
  await section();
  expect(text()).toContain("has no e-mail address yet");
  expect(text()).toContain("bots.example.invalid");
  await press("Give this bot an address");
  expect(writes).toEqual([
    { method: "POST", path: "/api/mailboxes/provision", body: { botId: BOT } },
  ]);
});

test("a refusal when giving an address shows the server's sentence", async () => {
  mailboxes = [];
  refusal = {
    status: 409,
    code: "NOT_OFFERED",
    message: "This server does not hand out e-mail addresses to bots.",
  };
  await section();
  await press("Give this bot an address");
  expect(text()).toContain("does not hand out e-mail addresses");
});

test("where the administrator set nothing up, no address is offered and no button shows", async () => {
  mailboxes = [];
  offer = { on: false, domain: "" };
  await section();
  expect(text()).toContain("does not give bots an address of their own");
  expect(text()).not.toContain("Give this bot an address");
});

test("only the owner can ask for one, and the Chief has none of its own", async () => {
  mailboxes = [];
  await section(bot({ canEdit: false }));
  const give = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent === "Give this bot an address",
  )!;
  expect(give.disabled).toBe(true);
  await section(bot({ kind: "chief" }));
  expect(text()).toContain("Only your other bots get an address");
});
