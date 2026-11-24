import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { FormCardData } from "../chat/form-card-data";

const win = setupDom();
Object.assign(globalThis, {
  scrollTo: () => {},
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const pair = await generateTransportKeyPair();
const BOT = "00000000-0000-7000-8000-0000000000c1";
const PASSWORD = "fake-app-password-for-test-only";
const detects: string[] = [];
const requests: { method: string; path: string; raw: string; body: Record<string, any> }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const raw = init?.body ? String(init.body) : "";
  requests.push({ method, path: url.pathname, raw, body: raw ? JSON.parse(raw) : {} });
  if (url.pathname === "/api/connections/transport-key")
    return Response.json({
      kid: "k1",
      publicKey: pair.publicKey,
      userId: "me",
      serverTime: Date.now(),
    });
  if (url.pathname === "/api/mail/detect") {
    detects.push(url.searchParams.get("address") ?? "");
    return Response.json({
      detection: {
        status: "known",
        message: "Use an app password.",
        imap: { host: "imap.example.invalid", port: 993, security: "tls" },
        smtp: { host: "smtp.example.invalid", port: 587, security: "starttls" },
        user: "ana@example.invalid",
        confidence: "checked",
      },
    });
  }
  if (url.pathname === "/api/mailboxes" && method === "POST")
    return Response.json(
      { mailbox: { id: "m1", address: "ana@example.invalid" } },
      { status: 201 },
    );
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  detects.length = 0;
  requests.length = 0;
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
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
const mount = async (prefill: FormCardData["prefill"]) => {
  const { FormCard } = await import("../chat/form-card");
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  const data: FormCardData = { form: "mailbox", botId: null, botName: null, prefill };
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <FormCard data={data} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return host;
};

test("the mailbox card looks up the servers of the address the chief suggested, and the password is sealed before it is sent", async () => {
  const host = await mount({
    address: "ana@example.invalid",
    label: "Work",
    ownerBotId: BOT,
    ownerBotName: "Mailer",
  });
  expect(host.textContent).toContain("Connect a mailbox");
  expect(host.textContent).toContain("Mailer will own this mailbox");
  // The servers were looked up on first show, with no click.
  expect(detects).toEqual(["ana@example.invalid"]);
  expect(field("imapHost").value).toBe("imap.example.invalid");
  expect(field("user").value).toBe("ana@example.invalid");
  expect(field("address").value).toBe("ana@example.invalid");
  expect(field("label").value).toBe("Work");

  await type("password", PASSWORD);
  await act(
    async () =>
      void win.document
        .querySelector('form[aria-label="Connect a mailbox"]')!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();

  const post = requests.find((r) => r.method === "POST" && r.path === "/api/mailboxes")!;
  expect(post).toBeDefined();
  // Nothing that left the browser holds the password in the clear; the server's key opens it.
  expect(requests.map((r) => r.raw).join("\n")).not.toContain(PASSWORD);
  expect(post.body.password).toBeUndefined();
  expect(post.body).toMatchObject({
    address: "ana@example.invalid",
    label: "Work",
    botId: BOT,
    imapHost: "imap.example.invalid",
  });
  const opened = (await open(pair.privateKey, post.body.sealed, {
    userId: "me",
    purpose: "mailbox.connect",
  })) as { password: string };
  expect(opened).toEqual({ password: PASSWORD });
  expect(host.textContent).toContain("Connected. The password is stored encrypted");
  expect(field("password")).toBeNull();
});

test("an empty card has empty fields and looks nothing up until an address is typed", async () => {
  await mount({});
  expect(detects).toEqual([]);
  expect(field("address").value).toBe("");
  expect(field("imapHost").value).toBe("");
});
