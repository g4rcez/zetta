import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const calls: { path: string; method: string }[] = [];
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => void (finished = true));
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push({ path: url.pathname, method: init?.method ?? "GET" });
  if (url.pathname.endsWith("/connect"))
    return Response.json({ authorizeUrl: "https://www.canva.com/api/oauth/authorize?x=1" });
  return Response.json({});
}) as typeof fetch;
globalThis.fetch = fake;

const { OAuthConnect, CUSTOM_OAUTH } = await import("./oauth-connect");

async function mount(props: Record<string, unknown>) {
  win.document.body.replaceChildren();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  await act(async () =>
    root.render(
      <OAuthConnect
        pluginId="canva"
        name="Canva"
        onChanged={() => {}}
        onError={() => {}}
        {...props}
      />,
    ),
  );
  return { host: host as unknown as HTMLElement, root };
}

test("a plugin with its own panel is left alone; Canva uses this one", () => {
  expect(CUSTOM_OAUTH.has("google")).toBe(true);
  expect(CUSTOM_OAUTH.has("canva")).toBe(false);
});

test("not connected: Connect asks the server for the consent page and goes there", async () => {
  const went: string[] = [];
  win.location.assign = ((u: string) => void went.push(u)) as never;
  const { host, root } = await mount({});
  expect(host.textContent).toContain("Not connected");
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Connect Canva")!.click();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(calls.some((c) => c.path.endsWith("/plugins/canva/connect") && c.method === "POST")).toBe(
    true,
  );
  expect(went).toEqual(["https://www.canva.com/api/oauth/authorize?x=1"]);
  await act(async () => root.unmount());
});

test("connected: it names the account and offers Disconnect", async () => {
  const { host, root } = await mount({
    probe: { status: { state: "connected", info: { account: "Demo" } } },
  });
  expect(host.textContent).toContain("Connected as Demo.");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Disconnect"]);
  await act(async () => root.unmount());
});
