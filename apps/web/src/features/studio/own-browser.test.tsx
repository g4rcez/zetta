import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Bun's own FormData cannot read a DOM form; the page uses the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => {
  globalThis.FormData = bunFormData;
  finished = true;
});

let ownBrowser = true;
let profiles: Record<string, unknown>[] = [
  { name: "default", mode: "shared", kind: "isolated", cdpPort: null, revoked: false },
];
const puts: { path: string; body: unknown }[] = [];
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (url.pathname === "/api/computer/capabilities")
    return Response.json({ browser: true, desktop: false, ownBrowser });
  if (url.pathname === "/api/computer/profiles") return Response.json({ profiles });
  if (method === "PUT" && url.pathname.endsWith("/own-browser")) {
    puts.push({ path: url.pathname, body });
    const name = decodeURIComponent(url.pathname.split("/")[4]!);
    profiles = profiles.map((p) =>
      p.name === name
        ? { ...p, kind: body.port === null ? "isolated" : "own", cdpPort: body.port }
        : p,
    );
    return Response.json({ profile: {} });
  }
  return Response.json({ error: { code: "TEST", message: "offline" } }, { status: 500 });
}) as typeof fetch;
globalThis.fetch = fake;

const { Profiles } = await import("./computer");
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";

async function mount() {
  win.document.body.replaceChildren();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <Profiles onError={(m) => console.error(m)} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return root;
}

test("a local install offers your own browser; the profile then says so and can go back", async () => {
  const root = await mount();
  expect(text()).toContain("Use your own browser");
  const port = win.document.querySelector('[name="port"]') as unknown as HTMLInputElement;
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(port, "9333");
  const form = win.document.querySelector('form[aria-label="Use your own browser"]')!;
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();
  expect(puts.at(-1)).toEqual({
    path: "/api/computer/profiles/default/own-browser",
    body: { port: 9333 },
  });
  expect(text()).toContain("Your browser, port 9333");
  const back = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent === "Use an isolated browser",
  )!;
  await act(async () => void back.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
  expect(puts.at(-1)!.body).toEqual({ port: null });
  expect(text()).not.toContain("Your browser, port");
  await act(async () => root.unmount());
});

test("a server open to the network does not offer it", async () => {
  ownBrowser = false;
  const root = await mount();
  expect(text()).not.toContain("Use your own browser");
  await act(async () => root.unmount());
});
