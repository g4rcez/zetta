import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateTransportKeyPair } from "@zetta/core/sealed-transport";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

/** The pages of a Google mailbox: the connect page for a Gmail address, the settings page, and the words of a failed read. */
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
const servers = {
  imapHost: "imap.example.invalid",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.example.invalid",
  smtpPort: 587,
  smtpSecurity: "starttls",
  user: ADDRESS,
};
const mailbox = (over: object = {}) => ({
  id: BOX,
  kind: "google",
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

const GOOGLE_DETECTION = {
  status: "google",
  message: "Gmail needs an app password.",
  provider: { id: "google", label: "Google" },
  imap: { host: "imap.example.invalid", port: 993, security: "tls" },
  smtp: { host: "smtp.example.invalid", port: 465, security: "tls" },
  user: ADDRESS,
  appPasswordUrl: "https://example.invalid/app-passwords",
  confidence: "checked",
};

let mailboxes: unknown[] = [];
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
  if (url.pathname === "/api/mail/detect") return Response.json({ detection: GOOGLE_DETECTION });
  if (url.pathname === "/api/mailboxes" && method === "GET") return Response.json({ mailboxes });
  if (url.pathname === "/api/bots") return Response.json({ bots: [] });
  if (method !== "GET") {
    writes.push({ method, path: url.pathname, body });
    if (refusal)
      return Response.json(
        { error: { code: refusal.code, message: refusal.message } },
        { status: refusal.status },
      );
    if (url.pathname === "/api/mailboxes/google") return Response.json({ mailbox: mailbox() });
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
const gmailAddress = async () => {
  await type("address", ADDRESS);
  await leave("address");
};

test("a Gmail address whose Google account is already connected points to that mailbox, and asks for no password", async () => {
  mailboxes = [mailbox({ label: "Gmail" })];
  await connect();
  await gmailAddress();
  expect(text()).toContain("already here");
  expect(text()).toContain("with no password");
  expect(linkTo("Open the inbox")?.getAttribute("href")).toBe(`/mail/${BOX}`);
  expect(field("password")).toBeNull();
  expect(buttons()).not.toContain("Connect");
  // The app-password advice of the provider is not shown: it is not needed.
  expect(text()).not.toContain("Create an app password");
});

test("the match is by address, in any case; another Google mailbox does not count", async () => {
  mailboxes = [mailbox({ address: "someone.else@example.invalid" })];
  await connect();
  await gmailAddress();
  expect(text()).not.toContain("already here");
  expect(field("password")).not.toBeNull();
  mailboxes = [mailbox({ address: ADDRESS.toUpperCase() })];
  await connect();
  await gmailAddress();
  expect(text()).toContain("already here");
});

test("a Gmail address with no Google account connected links to the Google plugin and keeps the app-password way", async () => {
  await connect();
  await gmailAddress();
  expect(text()).toContain("Connect your Google account once in the Google plugin");
  expect(linkTo("Set up Google")?.getAttribute("href")).toBe("/plugins/google");
  expect(buttons()).toContain("Already connected? Show it here");
  // The alternative stays: password form, the provider's app-password link and the Connect button.
  expect(text()).toContain("Or use an app password below");
  expect(field("password")).not.toBeNull();
  expect(linkTo("Create an app password")?.getAttribute("href")).toBe(
    "https://example.invalid/app-passwords",
  );
  expect(buttons()).toContain("Connect");
});

test("showing an account that was removed goes to its inbox; a refusal is shown in the server's words", async () => {
  const router = await connect();
  await gmailAddress();
  await press("Already connected? Show it here");
  const post = writes.find((w) => w.path === "/api/mailboxes/google")!;
  expect(post.method).toBe("POST");
  expect(post.body).toEqual({ address: ADDRESS });
  expect(router.state.location.pathname).toBe(`/mail/${BOX}`);

  writes.length = 0;
  refusal = {
    status: 409,
    code: "NO_GOOGLE",
    message: "That Google account is not connected with permission to read mail.",
  };
  await connect();
  await gmailAddress();
  await press("Already connected? Show it here");
  expect(text()).toContain("not connected with permission to read mail");
});

test("the settings of a Google mailbox have no server or password fields and say where the sign-in is managed", async () => {
  mailboxes = [mailbox()];
  await settings();
  expect(text()).toContain("read through your Google account");
  expect(text()).toContain("managed in the Google plugin");
  expect(linkTo("Open the Google plugin")?.getAttribute("href")).toBe("/plugins/google");
  for (const name of ["imapHost", "imapPort", "smtpHost", "smtpPort", "user", "password"])
    expect(field(name)).toBeNull();
  expect(win.document.querySelector('form[aria-label="Connection"]')).toBeNull();
  // The settings that are not servers stay.
  expect(win.document.querySelector('form[aria-label="General"]')).not.toBeNull();
  expect(field("label")).not.toBeNull();
});

test("a Google mailbox that needs its sign-in shows the server's sentence; removing it is hiding it", async () => {
  mailboxes = [
    mailbox({
      state: "needs_auth",
      lastError:
        "This Google account is not connected any more. Connect it again in Studio > Plugins > Google.",
    }),
  ];
  await settings();
  expect(text()).toContain("not connected any more");
  expect(text()).toContain("Hide this mailbox");
  expect(text()).toContain("stays connected in the Google plugin");
  expect(text()).not.toContain("saved password");
  await press("Hide mailbox");
  await press("Hide");
  expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([`DELETE /api/mailboxes/${BOX}`]);
});

test("an IMAP mailbox keeps its servers and its password field", async () => {
  mailboxes = [mailbox({ kind: "imap", servers })];
  await settings();
  expect(field("imapHost")?.value).toBe("imap.example.invalid");
  expect(field("password")).not.toBeNull();
  expect(text()).toContain("Remove this mailbox");
  expect(text()).not.toContain("Google plugin");
});

test("a failed read of a Google mailbox points to the Google plugin, and one of an IMAP mailbox to the password", async () => {
  const read = (kind: string) =>
    mount(async () => {
      mailboxes = [mailbox({ kind, state: "needs_auth" })];
      const { ReadFailure } = await import("./mail-states");
      return (
        <ReadFailure
          failure={{ kind: "needs_auth", message: "Google access for this mailbox was revoked." }}
          mailboxId={BOX}
          what="the inbox"
          onRetry={() => {}}
        />
      );
    });
  await read("google");
  expect(text()).toContain("Google access needs to be signed in again");
  expect(text()).toContain("revoked");
  expect(linkTo("Open the Google plugin")?.getAttribute("href")).toBe("/plugins/google");
  expect(text()).not.toContain("Change the password");
  await read("imap");
  expect(text()).toContain("The mail server did not accept the password");
  expect(text()).not.toContain("Google plugin");
});
