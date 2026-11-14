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
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      data: { completion: "paste" },
    });
  return Response.json({ ok: true });
}) as typeof fetch;
globalThis.fetch = fake;

const { GoogleConnect } = await import("./google-connect");

const opened: string[] = [];
const went: string[] = [];
beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  went.length = 0;
  win.open = ((u: string) => void opened.push(u)) as never;
  win.location.assign = ((u: string) => void went.push(u)) as never;
});

const waiting = {
  status: {
    state: "needs-auth",
    detail: "Not connected yet.",
    info: { signIn: { completion: "paste" } },
  },
} as never;
const idle = { status: { state: "needs-auth", detail: "Not connected yet." } } as never;

async function mount(props: Record<string, unknown>) {
  win.document.body.replaceChildren();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  const changed: number[] = [];
  await act(async () =>
    root.render(
      <GoogleConnect
        onChanged={() => void changed.push(1)}
        onError={() => {}}
        initialScopes={["gmail.readonly"]}
        {...props}
      />,
    ),
  );
  return { host: host as unknown as HTMLElement, root, changed };
}
const box = (host: HTMLElement) => host.querySelector('form[aria-label="Finish Google sign-in"]');

test("a Desktop sign-in opens Google in a tab, keeps this page and shows the paste step", async () => {
  const { host, root } = await mount({ probe: idle });
  expect(box(host)).toBeNull();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Connect with Google"))!
      .click();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(opened).toEqual(["https://accounts.google.com/o/oauth2/v2/auth?x=1"]);
  expect(went).toEqual([]);
  expect(box(host)).not.toBeNull();
  await act(async () => root.unmount());
});

test("a sign-in the server reports as waiting shows the paste step with no click (reload, Back, second tab)", async () => {
  const { host, root } = await mount({ probe: waiting });
  expect(box(host)).not.toBeNull();
  expect(opened).toEqual([]);
  await act(async () => root.unmount());
});

test("Cancel hides the step even while the server still reports the sign-in", async () => {
  const { host, root } = await mount({ probe: waiting });
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click();
  });
  expect(box(host)).toBeNull();
  await act(async () => root.unmount());
});

test("Finish sends the pasted address to the server and asks the page to look again", async () => {
  const { host, root, changed } = await mount({ probe: waiting });
  const input = box(host)!.querySelector("input") as unknown as HTMLInputElement;
  const pasted = "http://127.0.0.1:53682/?state=s&code=c";
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!;
    set.call(input, pasted);
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await act(async () => {
    box(host)!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never);
    await new Promise((r) => setTimeout(r, 20));
  });
  const sent = calls.find((c) => c.path.endsWith("/plugins/google/complete"));
  expect(sent?.method).toBe("POST");
  expect(JSON.parse(sent!.body!)).toEqual({ url: pasted });
  expect(changed.length).toBeGreaterThan(0);
  expect(host.textContent).toContain("Google connected.");
  await act(async () => root.unmount());
});
