import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const OPS = "00000000-0000-7000-8000-0000000000e1";
const DOCS = "00000000-0000-7000-8000-0000000000e2";
const bots = [
  { id: OPS, name: "Ops", kind: "specialist", avatar: null },
  { id: DOCS, name: "Docs", kind: "specialist", avatar: null },
];
const MAC = "00000000-0000-7000-8000-0000000000c1";
const fresh = () => [
  {
    id: MAC,
    name: "Work Mac",
    platform: "darwin",
    online: true,
    lastSeenAt: "2026-11-19T10:00:00Z",
    botIds: [OPS],
    createdAt: "2026-11-19T09:00:00Z",
  },
  {
    id: "00000000-0000-7000-8000-0000000000c2",
    name: "Home PC",
    platform: "win32",
    online: false,
    lastSeenAt: null,
    botIds: [],
    createdAt: "2026-11-19T09:00:00Z",
  },
];
let devices: Record<string, unknown>[] = fresh();
const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
const api = (path: string, method: string, body: Record<string, unknown> | undefined) => {
  if (method !== "GET") writes.push({ path, method, body: body ?? {} });
  if (path === "/api/devices" && method === "GET") return { devices };
  if (path === "/api/bots") return { bots };
  if (/^\/api\/devices\/[^/]+$/.test(path) && method === "PATCH") {
    devices = devices.map((d) =>
      path.endsWith(String(d.id)) ? { ...d, botIds: body?.botIds } : d,
    );
    return { device: devices[0] };
  }
  if (/^\/api\/devices\/[^/]+$/.test(path) && method === "DELETE") {
    devices = devices.filter((d) => !path.endsWith(String(d.id)));
    return { ok: true };
  }
  throw new Error(`unexpected ${method} ${path}`);
};
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  try {
    return Response.json(
      api(
        `${url.pathname}${url.search}`,
        init?.method ?? "GET",
        init?.body ? JSON.parse(String(init.body)) : undefined,
      ),
    );
  } catch (e) {
    return Response.json(
      { error: { code: "TEST", message: (e as Error).message } },
      { status: 500 },
    );
  }
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
const press = async (label: string, nth = 0) => {
  const matches = [...win.document.querySelectorAll("button")].filter(
    (x) => x.textContent?.trim() === label,
  );
  const b = matches[nth];
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const toggleBot = async (name: string) => {
  const box = win.document.querySelector(
    `input[aria-label="${name}"]`,
  ) as unknown as HTMLInputElement;
  await act(
    async () =>
      void box.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event),
  );
  await settle();
};

const mount = async () => {
  const { DevicesPanel } = await import("./devices");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errors: string[] = [];
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DevicesPanel onError={(m) => errors.push(m)} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { errors, unmount: () => act(async () => root.unmount()) };
};

test("each computer shows its system, whether it is online and which bots may use it", async () => {
  devices = fresh();
  const { unmount, errors } = await mount();
  expect(text()).toContain("Your computers");
  expect(text()).toContain("Work Mac");
  expect(text()).toContain("Online");
  expect(text()).toContain("Mac");
  expect(text()).toContain("Home PC");
  expect(text()).toContain("Offline");
  expect(text()).toContain("Windows");
  expect(text()).toContain("Shared with");
  expect(text()).toContain("Not shared with any bot yet");
  expect(errors).toEqual([]);
  await unmount();
});

test("with no computer paired the section is not there at all", async () => {
  devices = [];
  const { unmount } = await mount();
  expect(text()).not.toContain("Your computers");
  await unmount();
});

test("sharing a computer sends the bots that were picked", async () => {
  devices = fresh();
  writes.length = 0;
  const { unmount, errors } = await mount();
  await press("Share with bots", 1);
  await toggleBot("Docs");
  await press("Save");
  expect(errors).toEqual([]);
  expect(writes).toEqual([
    {
      path: `/api/devices/00000000-0000-7000-8000-0000000000c2`,
      method: "PATCH",
      body: { botIds: [DOCS] },
    },
  ]);
  expect(text()).toContain("Home PC is shared with 1 bot.");
  await unmount();
});

test("removing a computer asks first, then revokes it", async () => {
  devices = fresh();
  writes.length = 0;
  const { unmount } = await mount();
  await press("Remove", 0);
  expect(writes).toEqual([]);
  // The question replaced the button: the first "Remove" is now its confirmation.
  await press("Remove", 0);
  expect(writes).toEqual([{ path: `/api/devices/${MAC}`, method: "DELETE", body: {} }]);
  expect(text()).toContain("Work Mac is no longer paired.");
  await unmount();
});
