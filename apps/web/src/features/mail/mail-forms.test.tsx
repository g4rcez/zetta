import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";
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

const pair = await generateTransportKeyPair();
const BOX = "00000000-0000-7000-8000-0000000000b1";
const BOT = "00000000-0000-7000-8000-0000000000c1";
const PASSWORD = "fake-app-password-for-test-only";
const servers = {
  imapHost: "imap.example.invalid",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.example.invalid",
  smtpPort: 587,
  smtpSecurity: "starttls",
  user: "ana@example.invalid",
};
const mailbox = (over: object = {}) => ({
  id: BOX,
  kind: "imap",
  address: "ana@example.invalid",
  label: "Work",
  state: "active",
  lastError: null,
  sending: "off",
  ownerBotId: null,
  allowedSenders: [],
  servers,
  ...over,
});

type Detect = Record<string, unknown>;
let detection: Detect = {};
let mailboxes: unknown[] = [mailbox()];
let refusal: { status: number; code: string; message: string; fix?: string } | undefined;
const writes: { method: string; path: string; body: Record<string, any> }[] = [];
const detects: string[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (url.pathname === "/api/connections/transport-key")
    return Response.json({
      kid: "k1",
      publicKey: pair.publicKey,
      userId: "me",
      serverTime: Date.now(),
    });
  if (url.pathname === "/api/mail/detect") {
    detects.push(url.searchParams.get("address") ?? "");
    return Response.json({ detection });
  }
  if (url.pathname === "/api/mailboxes" && method === "GET") return Response.json({ mailboxes });
  if (url.pathname === "/api/bots")
    return Response.json({ bots: [{ id: BOT, name: "Mailer", kind: "specialist", avatar: null }] });
  if (method !== "GET") {
    writes.push({ method, path: url.pathname, body });
    if (refusal)
      return Response.json(
        {
          error: {
            code: refusal.code,
            message: refusal.message,
            ...(refusal.fix ? { fix: refusal.fix } : {}),
          },
        },
        { status: refusal.status },
      );
    if (method === "DELETE") return Response.json({ ok: true });
    return Response.json({ mailbox: mailbox({ ...body, id: BOX }) });
  }
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  detection = {};
  mailboxes = [mailbox()];
  refusal = undefined;
  writes.length = 0;
  detects.length = 0;
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
const connect = () =>
  mount(async () => {
    const { MailConnectPage } = await import("./mail-connect-page");
    return <MailConnectPage />;
  });
const settings = () =>
  mount(async () => {
    const { MailSettingsPage } = await import("./mail-settings-page");
    return <MailSettingsPage mailboxId={BOX} />;
  });
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
const type = async (name: string, value: string) => {
  const el = field(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
    el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
};
const leave = async (name: string) => {
  const el = field(name);
  await act(
    async () => void el.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }) as never),
  );
  await settle();
};
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
const advanced = () =>
  win.document.querySelector(
    '[data-component="advanced-section"]',
  ) as unknown as HTMLDetailsElement;

const GMAILISH = {
  status: "known",
  message: "Use an app password, not your account password.",
  provider: { id: "example", label: "Example Mail" },
  imap: { host: "imap.example.invalid", port: 993, security: "tls" },
  smtp: { host: "smtp.example.invalid", port: 465, security: "tls" },
  user: "ana@example.invalid",
  appPasswordUrl: "https://example.invalid/app-passwords",
  confidence: "checked",
};

test("leaving the address fills the servers and shows the provider's guidance and link; Advanced stays closed", async () => {
  detection = GMAILISH;
  await connect();
  await type("address", "ana@example.invalid");
  await leave("address");
  expect(detects).toEqual(["ana@example.invalid"]);
  expect(text()).toContain("Use an app password");
  const link = [...win.document.querySelectorAll("a")].find(
    (a) => a.textContent === "Create an app password",
  )!;
  expect(link.getAttribute("href")).toBe("https://example.invalid/app-passwords");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(field("imapHost").value).toBe("imap.example.invalid");
  expect(field("smtpPort").value).toBe("465");
  expect(field("user").value).toBe("ana@example.invalid");
  expect(advanced().open).toBe(false);
});

test("when nothing is found the servers are typed by hand and Advanced opens by itself", async () => {
  detection = {
    status: "unknown",
    message: "The mail servers of this address could not be found. Enter them yourself.",
    user: "x@example.invalid",
  };
  await connect();
  await type("address", "x@example.invalid");
  await leave("address");
  expect(text()).toContain("could not be found. Enter them yourself");
  expect(advanced().open).toBe(true);
  expect(field("imapHost").value).toBe("");
});

test("a Microsoft address points to the Microsoft plugin and offers no password form", async () => {
  detection = {
    status: "microsoft",
    message: "Microsoft no longer accepts a password for IMAP.",
    provider: { id: "microsoft", label: "Microsoft" },
    next: { type: "plugin", pluginId: "microsoft" },
  };
  await connect();
  await type("address", "a@example.invalid");
  await leave("address");
  expect(text()).toContain("Set up Microsoft");
  expect(text()).not.toContain("not supported yet");
  expect(field("password")).toBeNull();
  expect(
    [...win.document.querySelectorAll("button")].some((b) => b.textContent === "Connect"),
  ).toBe(false);
});

test("connecting seals the password for this purpose, never sends it in the clear, and goes to the new mailbox", async () => {
  detection = GMAILISH;
  const router = await connect();
  await type("address", "ana@example.invalid");
  await leave("address");
  await type("label", "Work");
  await type("password", PASSWORD);
  await submit("Connect a mailbox");
  const post = writes.find((w) => w.path === "/api/mailboxes")!;
  expect(post.method).toBe("POST");
  expect(JSON.stringify(post.body)).not.toContain(PASSWORD);
  expect(post.body).toMatchObject({
    address: "ana@example.invalid",
    label: "Work",
    imapHost: "imap.example.invalid",
    imapPort: 993,
    smtpPort: 465,
    user: "ana@example.invalid",
  });
  expect(
    await open(
      pair.privateKey,
      post.body.sealed,
      { userId: "me", purpose: "mailbox.connect" },
      Date.now(),
    ),
  ).toEqual({ password: PASSWORD });
  expect(router.state.location.pathname).toBe(`/mail/${BOX}`);
});

test("a refused password is shown next to the password field, which is emptied", async () => {
  detection = GMAILISH;
  refusal = {
    status: 422,
    code: "AUTH",
    message: "The mail server did not accept the password.",
    fix: "Use an app password.",
  };
  const router = await connect();
  await type("address", "ana@example.invalid");
  await leave("address");
  await type("password", "wrong");
  await submit("Connect a mailbox");
  expect(text()).toContain("The mail server did not accept the password. Use an app password.");
  expect(field("password").value).toBe("");
  expect(router.state.location.pathname).toBe("/");
});

test("a server that cannot be reached is shown next to the server field, and Advanced opens", async () => {
  detection = GMAILISH;
  refusal = {
    status: 502,
    code: "UNREACHABLE",
    message: "The mail server could not be reached to check it.",
    fix: "Check the server name and port.",
  };
  await connect();
  await type("address", "ana@example.invalid");
  await leave("address");
  await type("password", PASSWORD);
  await submit("Connect a mailbox");
  expect(text()).toContain(
    "The mail server could not be reached to check it. Check the server name and port.",
  );
  expect(advanced().open).toBe(true);
  expect(field("password").value).toBe(PASSWORD);
});

test("missing servers are told before anything is sent", async () => {
  await connect();
  await type("address", "ana@example.invalid");
  await type("password", PASSWORD);
  await submit("Connect a mailbox");
  expect(text()).toContain("Enter the incoming mail server and its port.");
  expect(writes).toEqual([]);
});

test("settings: owner bot, sending and label are saved together; allowed senders are not offered", async () => {
  await settings();
  expect(text()).toContain("ana@example.invalid");
  expect(text()).toContain("No bot: Zetta's assistant answers");
  expect(text()).toContain("when you ask in the chat, the bot sends the mail");
  expect(text().toLowerCase()).not.toContain("allowed sender");
  await type("label", "Support");
  const sendingOn = win.document.querySelector(
    'input[name="sending"]',
  ) as unknown as HTMLInputElement;
  await act(
    async () =>
      void sendingOn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await submit("General");
  const patch = writes.find((w) => w.method === "PATCH")!;
  expect(patch.path).toBe(`/api/mailboxes/${BOX}`);
  expect(patch.body).toEqual({ label: "Support", botId: null, sending: "on" });
  expect(text()).toContain("Saved.");
});

test("settings: choosing a bot shows its identity and sends its id", async () => {
  mailboxes = [mailbox({ ownerBotId: BOT })];
  await settings();
  expect(text()).toContain("Mailer");
  await submit("General");
  expect(writes.find((w) => w.method === "PATCH")!.body.botId).toBe(BOT);
});

test("settings: new servers and a password are re-checked by the server; the password is sealed for this mailbox", async () => {
  await settings();
  await type("imapHost", "imap2.example.invalid");
  await type("password", PASSWORD);
  await submit("Connection");
  const patch = writes.find((w) => w.method === "PATCH")!;
  expect(JSON.stringify(patch.body)).not.toContain(PASSWORD);
  expect(patch.body.imapHost).toBe("imap2.example.invalid");
  expect(
    await open(
      pair.privateKey,
      patch.body.sealed,
      { userId: "me", purpose: `mailbox.password:${BOX}` },
      Date.now(),
    ),
  ).toEqual({ password: PASSWORD });
  expect(text()).toContain("Checked and saved.");
});

test("settings: a refused check is shown at the password and nothing changes on the page", async () => {
  refusal = { status: 422, code: "AUTH", message: "The mail server did not accept the password." };
  await settings();
  await type("password", "nope");
  await submit("Connection");
  expect(text()).toContain("The mail server did not accept the password.");
  expect(text()).not.toContain("Checked and saved.");
});

test("settings: removing asks first and says mail on the provider is not touched", async () => {
  const router = await settings();
  expect(text()).toContain("Mail on the provider is not touched");
  await press("Remove mailbox");
  expect(writes).toEqual([]);
  expect(text()).toContain(
    "Remove ana@example.invalid from Zetta? Mail on the provider is not touched.",
  );
  await press("Remove");
  expect(writes).toEqual([
    { method: "DELETE", path: `/api/mailboxes/${BOX}`, body: undefined as never },
  ]);
  expect(router.state.location.pathname).toBe("/mail");
});

test("settings: a mailbox that needs its password says so", async () => {
  mailboxes = [mailbox({ state: "needs_auth" })];
  await settings();
  expect(text()).toContain("The mail server did not accept the password. Enter it again below.");
});

test("/mail goes to the first mailbox, or offers to connect one", async () => {
  const router = await mount(async () => {
    const { MailIndexPage } = await import("./mail-index-page");
    return <MailIndexPage />;
  });
  expect(router.state.location.pathname).toBe(`/mail/${BOX}`);
  mailboxes = [];
  await mount(async () => {
    const { MailIndexPage } = await import("./mail-index-page");
    return <MailIndexPage />;
  });
  expect(text()).toContain("No mailbox yet");
});
