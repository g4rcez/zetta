import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateTransportKeyPair } from "@zetta/core/sealed-transport";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

/** The pages of a Microsoft mailbox (Outlook.com, Microsoft 365): the connect page for such an address, the settings page, and the words of a failed read. No real Microsoft account was used. */
const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const pair = await generateTransportKeyPair();
const BOX = "00000000-0000-7000-8000-0000000000a1";
const ADDRESS = "ana@example.invalid";
const mailbox = (over: object = {}) => ({
  id: BOX,
  kind: "microsoft",
  address: ADDRESS,
  label: "",
  state: "active",
  lastError: null,
  sending: "off",
  ownerBotId: null,
  allowedSenders: [],
  servers: {},
  ...over,
});

const MICROSOFT_DETECTION = {
  status: "microsoft",
  message:
    "Microsoft no longer accepts a password for IMAP. Zetta connects it through the Microsoft plugin.",
  provider: { id: "microsoft", label: "Microsoft" },
  next: { type: "plugin", pluginId: "microsoft" },
};

let mailboxes: unknown[] = [];
// The server points at the mailbox once the account is connected.
const detection = () => ({
  ...MICROSOFT_DETECTION,
  ...(mailboxes.length ? { next: { type: "mailbox", mailboxId: BOX } } : {}),
});
let refusal: { status: number; code: string; message: string } | undefined;
const writes: { method: string; path: string; body: Record<string, any> }[] = [];

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
  if (url.pathname === "/api/mail/detect") return Response.json({ detection: detection() });
  if (url.pathname === "/api/mailboxes" && method === "GET") return Response.json({ mailboxes });
  if (url.pathname === "/api/bots") return Response.json({ bots: [] });
  if (method !== "GET") {
    writes.push({ method, path: url.pathname, body });
    if (refusal)
      return Response.json(
        { error: { code: refusal.code, message: refusal.message } },
        { status: refusal.status },
      );
    if (url.pathname === "/api/mailboxes/microsoft") return Response.json({ mailbox: mailbox() });
    return Response.json({ ok: true });
  }
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  mailboxes = [];
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
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | null;
const type = async (name: string, value: string) => {
  const el = field(name)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
    el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
};
const leave = async (name: string) => {
  await act(
    async () =>
      void field(name)!.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }) as never),
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
const buttons = () =>
  [...win.document.querySelectorAll("button")].map((b) => b.textContent?.trim());
const linkTo = (label: string) =>
  [...win.document.querySelectorAll("a")].find((a) => a.textContent?.trim() === label);
const outlookAddress = async () => {
  await type("address", ADDRESS);
  await leave("address");
};

test("an address whose Microsoft account is already connected points to that mailbox, and asks for no password", async () => {
  mailboxes = [mailbox({ label: "Outlook" })];
  await connect();
  await outlookAddress();
  expect(text()).toContain("already here");
  expect(text()).toContain("through your Microsoft connection, with no password");
  expect(linkTo("Open the inbox")?.getAttribute("href")).toBe(`/mail/${BOX}`);
  expect(field("password")).toBeNull();
  expect(buttons()).not.toContain("Connect");
});

test("the match is by address, in any case; another Microsoft mailbox does not count", async () => {
  mailboxes = [mailbox({ address: ADDRESS.toUpperCase() })];
  await connect();
  await outlookAddress();
  expect(text()).toContain("already here");
});

test('an address with no Microsoft account connected links to the Microsoft plugin, with no password way and no "not supported"', async () => {
  await connect();
  await outlookAddress();
  expect(text()).toContain("Connect your Microsoft account once in the Microsoft plugin");
  expect(text()).toContain("Mail: read messages");
  expect(linkTo("Set up Microsoft")?.getAttribute("href")).toBe("/plugins/microsoft");
  expect(buttons()).toContain("Already connected? Show it here");
  // Microsoft turned passwords off: there is no form and no app-password advice.
  expect(field("password")).toBeNull();
  expect(buttons()).not.toContain("Connect");
  expect(text()).not.toContain("app password");
  expect(text()).not.toContain("not supported");
});

test("showing an account that was removed goes to its inbox; a refusal is shown in the server's words", async () => {
  const router = await connect();
  await outlookAddress();
  await press("Already connected? Show it here");
  const post = writes.find((w) => w.path === "/api/mailboxes/microsoft")!;
  expect(post.method).toBe("POST");
  expect(post.body).toEqual({ address: ADDRESS });
  expect(router.state.location.pathname).toBe(`/mail/${BOX}`);

  writes.length = 0;
  refusal = {
    status: 409,
    code: "NO_MICROSOFT",
    message: "That Microsoft account is not connected with permission to read mail.",
  };
  await connect();
  await outlookAddress();
  await press("Already connected? Show it here");
  expect(text()).toContain("not connected with permission to read mail");
});

test("the settings of a Microsoft mailbox have no server or password fields and say where the sign-in is managed", async () => {
  mailboxes = [mailbox()];
  await settings();
  expect(text()).toContain("read through your Microsoft account");
  expect(text()).toContain("managed in the Microsoft plugin");
  expect(linkTo("Open the Microsoft plugin")?.getAttribute("href")).toBe("/plugins/microsoft");
  for (const name of ["imapHost", "imapPort", "smtpHost", "smtpPort", "user", "password"])
    expect(field(name)).toBeNull();
  expect(win.document.querySelector('form[aria-label="Connection"]')).toBeNull();
  expect(win.document.querySelector('form[aria-label="General"]')).not.toBeNull();
});

test("a Microsoft mailbox that needs its sign-in shows the server's sentence; removing it is hiding it", async () => {
  mailboxes = [
    mailbox({
      state: "needs_auth",
      lastError:
        "This Microsoft account is not connected any more. Connect it again in Studio > Plugins > Microsoft.",
    }),
  ];
  await settings();
  expect(text()).toContain("not connected any more");
  expect(text()).toContain("Hide this mailbox");
  expect(text()).toContain("stays connected in the Microsoft plugin");
  expect(text()).toContain("mail on Outlook is not touched");
  expect(text()).not.toContain("saved password");
  await press("Hide mailbox");
  await press("Hide");
  expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([`DELETE /api/mailboxes/${BOX}`]);
});

test("a failed read of a Microsoft mailbox points to the Microsoft plugin, and one of an IMAP mailbox to the password", async () => {
  const read = (kind: string) =>
    mount(async () => {
      mailboxes = [mailbox({ kind, state: "needs_auth" })];
      const { ReadFailure } = await import("./mail-states");
      return (
        <ReadFailure
          failure={{
            kind: "needs_auth",
            message: "Microsoft access for this mailbox was revoked.",
          }}
          mailboxId={BOX}
          what="the inbox"
          onRetry={() => {}}
        />
      );
    });
  await read("microsoft");
  expect(text()).toContain("Microsoft access needs to be signed in again");
  expect(text()).toContain("revoked");
  expect(linkTo("Open the Microsoft plugin")?.getAttribute("href")).toBe("/plugins/microsoft");
  expect(text()).not.toContain("Change the password");
  await read("imap");
  expect(text()).toContain("The mail server did not accept the password");
  expect(text()).not.toContain("Microsoft plugin");
});
