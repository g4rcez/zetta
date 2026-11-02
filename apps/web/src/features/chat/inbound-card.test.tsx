import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// happy-dom has no ResizeObserver, which the error Alert of the component library reads.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const pair = await generateTransportKeyPair();

const BOT = "b1";
const settings = [
  { key: "hookUrl", label: "Zetta address", from: "", to: "http://host.docker.internal:3000" },
];
const incoming = { state: "on", filter: { direct: true, groups: false, chats: [] } };
const base = { plugin: "chan", pluginName: "Chan", botId: BOT, botName: "Zetta" };

/** What the fake server saw, in order, and what it will answer. */
let seen: string[] = [];
let route: unknown = null;
let failConfig = false;
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const path = url.pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (path === "/api/connections/transport-key")
    return Response.json({
      kid: "k1",
      publicKey: pair.publicKey,
      userId: "user-a",
      serverTime: Date.now(),
    });
  if (path === "/api/plugins/chan/config" && method === "PUT") {
    if (failConfig)
      return Response.json(
        { error: { code: "INVALID_FIELD", message: "Zetta address must be an http(s) address." } },
        { status: 400 },
      );
    const opened = await open(
      pair.privateKey,
      body.sealed,
      { userId: "user-a", purpose: "plugin.configure:chan" },
      Date.now(),
    );
    seen.push(`config ${JSON.stringify(opened)}`);
    return Response.json({ plugin: { id: "chan", changed: true } });
  }
  if (path === `/api/bots/${BOT}/inbound` && method === "GET")
    return Response.json({
      available: [{ pluginId: "chan", name: "Chan", label: "Chan", bound: true, route }],
    });
  if (path === `/api/bots/${BOT}/inbound/chan` && method === "PUT") {
    seen.push(`route ${JSON.stringify(body)}`);
    return Response.json({ route: { ...body, id: "r1", botId: BOT, pluginId: "chan" } });
  }
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const text = () => win.document.body.textContent ?? "";
const press = async (label: string) => {
  const b = [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const mount = async (data: object) => {
  const { InboundCard } = await import("./inbound-card");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<InboundCard data={data as never} />));
  await settle();
  return () => act(async () => root.unmount());
};
const reset = () => {
  seen = [];
  route = null;
  failConfig = false;
  win.document.body.innerHTML = "";
};

test("the card shows the exact change and saves nothing until Apply; Apply saves the settings, then the route", async () => {
  reset();
  const unmount = await mount({ ...base, settings, incoming });
  expect(text()).toContain("Change to Chan");
  expect(text()).toContain("http://host.docker.internal:3000");
  expect(text()).toContain("Zetta answers new Chan messages from direct chats only.");
  expect(text()).toContain("sends the text of each new message to this address");
  expect(seen).toEqual([]);
  await press("Apply");
  expect(seen).toEqual([
    'config {"config":{"hookUrl":"http://host.docker.internal:3000"}}',
    'route {"enabled":true,"filter":{"direct":true,"groups":false,"chats":[]}}',
  ]);
  expect(text()).toContain("Applied. Tell Zetta to carry on.");
  expect([...win.document.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(
    [],
  );
  await unmount();
});

test("a failed save shows the reason, saves no route, and the card can be applied again", async () => {
  reset();
  failConfig = true;
  const unmount = await mount({ ...base, settings, incoming });
  await press("Apply");
  expect(text()).toContain("Zetta address must be an http(s) address.");
  expect(seen).toEqual([]);
  failConfig = false;
  await press("Apply");
  expect(seen).toHaveLength(2);
  await unmount();
});

test("a route that is already in place shows as applied after a reload, and says whom it replaces", async () => {
  reset();
  route = {
    id: "r1",
    botId: BOT,
    enabled: true,
    filter: { direct: true, groups: false, chats: [] },
  };
  const unmount = await mount({ ...base, settings: [], incoming });
  expect(text()).toContain("Applied.");
  await unmount();
  reset();
  const again = await mount({
    ...base,
    settings: [],
    incoming: { ...incoming, replaces: "Support" },
  });
  expect(text()).toContain("This replaces Support, which answers them now.");
  expect(text()).not.toContain("Applied.");
  await again();
});

test("turning off is shown as stopping, and Not now removes the card without saving", async () => {
  reset();
  route = { id: "r1", botId: BOT, enabled: true, filter: incoming.filter }; // it is on now
  const unmount = await mount({
    ...base,
    settings: [],
    incoming: { state: "off", filter: incoming.filter },
  });
  expect(text()).toContain("Zetta stops answering new Chan messages.");
  await press("Not now");
  expect(text()).not.toContain("Change to Chan");
  expect(seen).toEqual([]);
  await unmount();
});
