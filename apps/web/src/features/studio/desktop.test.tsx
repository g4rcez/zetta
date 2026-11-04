import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Bun's own FormData cannot read a DOM form; the page uses the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const pair = await generateTransportKeyPair();
const TOKEN = "fake-remote-bearer-token-123";
const posts: { path: string; body: Record<string, unknown> }[] = [];
let vms: Record<string, unknown>[] = [
  {
    id: "00000000-0000-7000-8000-0000000000c1",
    name: "Office Mac",
    kind: "extra",
    target: "cua",
    endpoint: "https://mac.example.invalid",
    driver: "cua",
    os: "debian",
    purpose: null,
    createdByBotId: null,
    status: "running",
    control: "agent",
    epoch: 0,
  },
];
const api = (path: string, method: string, body: Record<string, unknown> | undefined) => {
  if (method !== "GET") posts.push({ path, body: body ?? {} });
  if (path === "/api/computer/vms" && method === "GET") return { vms };
  if (path === "/api/computer/capabilities")
    return {
      browser: true,
      desktop: true,
      targets: { vm: ["cua"], local: [], cua: ["cua"] },
      os: [{ id: "debian", family: "linux", label: "Debian", browser: true, available: true }],
    };
  if (path === "/api/connections/transport-key")
    return { kid: "k1", publicKey: pair.publicKey, userId: "me", serverTime: Date.now() };
  if (path === "/api/computer/vms" && method === "POST") {
    vms = [
      ...vms,
      {
        ...vms[0],
        id: "00000000-0000-7000-8000-0000000000c2",
        name: String(body?.name),
        endpoint: String(body?.endpoint),
        status: "stopped",
      },
    ];
    return { vm: vms.at(-1) };
  }
  throw new Error(`unexpected ${method} ${path}`);
};
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  try {
    return Response.json(
      api(
        url.pathname,
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
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
// The computer's name box is a controlled input without a name attribute.
const control = (name: string) =>
  name === "name"
    ? (win.document.querySelector('input[placeholder^="Name"]') as unknown as HTMLInputElement)
    : field(name);
const type = async (name: string, value: string) => {
  const el = control(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    if (name === "name") {
      // The library's controlled box did not react to a simulated input event in this DOM, so its React onChange is called directly.
      const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[
        Object.keys(el).find((k) => k.startsWith("__reactProps"))!
      ]!;
      props.onChange!({ target: el, currentTarget: el });
    } else {
      el.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
      el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
    }
  });
};

test("a remote Cua computer shows its address and offers no viewer; its token leaves the page sealed", async () => {
  const { VmPanel } = await import("./desktop");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const errors: string[] = [];
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <VmPanel onError={(m) => errors.push(m)} />
      </QueryClientProvider>,
    ),
  );
  await settle();

  // The row says it is remote and where; a running remote computer has Stop but no Open (there is no VNC to show).
  expect(text()).toContain("remote Cua · https://mac.example.invalid");
  const labels = [...win.document.querySelectorAll("button")].map((b) => b.textContent?.trim());
  expect(labels).toContain("Stop");
  expect(labels).not.toContain("Open");

  // Choose the remote type: the address and token fields replace the system and driver choices.
  const select = [...win.document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === "cua" && o.textContent?.includes("Remote")),
  )!;
  await act(async () => {
    (select as unknown as HTMLSelectElement).value = "cua";
    select.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
  await settle();
  await type("name", "Lab Mac");
  await type("endpoint", "https://lab.example.invalid:3211");
  await type("token", TOKEN);
  const form = field("token").closest("form")!;
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();

  const create = posts.find((p) => p.path === "/api/computer/vms")!;
  expect(errors).toEqual([]);
  expect(JSON.stringify(create.body)).not.toContain(TOKEN);
  expect(Object.keys(create.body).sort()).toEqual(["endpoint", "name", "sealed", "target"]);
  expect(create.body).toMatchObject({
    name: "Lab Mac",
    target: "cua",
    endpoint: "https://lab.example.invalid:3211",
  });
  expect(
    await open(
      pair.privateKey,
      create.body.sealed as never,
      { userId: "me", purpose: "computer.create:cua" },
      Date.now(),
    ),
  ).toEqual({ secret: TOKEN });
  expect(text()).toContain("https://lab.example.invalid:3211");
  expect(field("token").value).toBe("");
  await act(async () => root.unmount());
});
