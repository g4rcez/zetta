import { afterAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const calls: { path: string; method: string; body?: string }[] = [];
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => void (finished = true));
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body as string });
  if (url.pathname.endsWith("/connect"))
    return Response.json({
      authorizeUrl: "https://login.example.invalid/common/oauth2/v2.0/authorize?x=1",
      data: { completion: "paste" },
    });
  return Response.json({ ok: true });
}) as typeof fetch;
globalThis.fetch = fake;

const { MicrosoftConnect } = await import("./microsoft-connect");

const opened: string[] = [];
beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  win.open = ((u: string) => void opened.push(u)) as never;
});

const idle = { status: { state: "needs-auth", detail: "Not connected yet." } } as never;
const waiting = {
  status: { state: "needs-auth", info: { signIn: { completion: "paste" } } },
} as never;
const connected = {
  status: {
    state: "connected",
    info: {
      accounts: [
        { email: "ana@example.invalid", state: "connected", scopes: ["Mail.Read"] },
        { email: "old@example.invalid", state: "needs-auth", scopes: [] },
      ],
    },
  },
} as never;

async function mount(props: Record<string, unknown>) {
  win.document.body.replaceChildren();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  const changed: number[] = [];
  await act(async () =>
    root.render(
      <MicrosoftConnect onChanged={() => void changed.push(1)} onError={() => {}} {...props} />,
    ),
  );
  return { host: host as unknown as HTMLElement, root, changed };
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

test("signing in asks for the ticked permissions, opens Microsoft in a tab and shows the paste step", async () => {
  const { host, root } = await mount({ probe: idle });
  await act(async () => {
    button(host, "Sign in with Microsoft").click();
    await new Promise((r) => setTimeout(r, 20));
  });
  const sent = calls.find((c) => c.path.endsWith("/plugins/microsoft/connect"))!;
  expect(JSON.parse(sent.body!)).toEqual({ options: { scopes: ["Mail.Read"] } });
  expect(opened).toEqual(["https://login.example.invalid/common/oauth2/v2.0/authorize?x=1"]);
  expect(host.querySelector('form[aria-label="Finish Microsoft sign-in"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("a sign-in the server reports as waiting shows the paste step with no click; Finish sends the pasted address", async () => {
  const { host, root, changed } = await mount({ probe: waiting });
  const form = host.querySelector('form[aria-label="Finish Microsoft sign-in"]')!;
  const input = form.querySelector("input") as unknown as HTMLInputElement;
  const pasted = "http://localhost:53682/?code=c&state=s";
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!;
    set.call(input, pasted);
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await act(async () => {
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never);
    await new Promise((r) => setTimeout(r, 20));
  });
  const done = calls.find((c) => c.path.endsWith("/plugins/microsoft/complete"))!;
  expect(JSON.parse(done.body!)).toEqual({ url: pasted });
  expect(changed.length).toBeGreaterThan(0);
  expect(host.textContent).toContain("Microsoft connected.");
  await act(async () => root.unmount());
});

test("the accounts are listed with what they may do, and one is disconnected by itself", async () => {
  const { host, root } = await mount({ probe: connected });
  expect(host.textContent).toContain("ana@example.invalid");
  expect(host.textContent).toContain("Read mail");
  expect(host.textContent).toContain("Reconnect needed");
  expect(host.textContent).toContain("Each account is a mailbox in Mail by itself");
  await act(async () => {
    host
      .querySelector('[aria-label="Microsoft account old@example.invalid"] button')!
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never);
    await new Promise((r) => setTimeout(r, 20));
  });
  const gone = calls.find((c) => c.path.endsWith("/plugins/microsoft/disconnect"))!;
  expect(JSON.parse(gone.body!)).toEqual({ options: { account: "old@example.invalid" } });
  await act(async () => root.unmount());
});
