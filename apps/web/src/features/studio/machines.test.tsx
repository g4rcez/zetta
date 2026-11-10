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
const FINGERPRINT = "SHA256:vrHPOFcz7mGR1uHRp0PH82dQOQY9pq+2GaWfhttdTeA";
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIATuBV2ktuq3oFQO73FGrq92TshlkGHPmbljpoDTEOZT";
const PASSWORD = "fake-password-for-test-only";
const posts: { path: string; body: Record<string, unknown> }[] = [];
const OPS = "00000000-0000-7000-8000-0000000000e1";
const DOCS = "00000000-0000-7000-8000-0000000000e2";
const bots = [
  { id: OPS, name: "Ops", kind: "specialist", avatar: null },
  { id: DOCS, name: "Docs", kind: "specialist", avatar: null },
];
const WEB = "00000000-0000-7000-8000-0000000000a1";
const fresh = () => [
  {
    id: WEB,
    name: "Web server",
    kind: "ssh",
    host: "server.example.invalid",
    port: 2222,
    username: "deploy",
    fingerprint: FINGERPRINT,
    hasSecret: true,
    botIds: [OPS],
    createdAt: "2026-11-04T00:00:00Z",
  },
  {
    id: "00000000-0000-7000-8000-0000000000a2",
    name: "Backup box",
    kind: "ftp",
    host: "backup.example.invalid",
    port: 21,
    username: "bob",
    fingerprint: null,
    hasSecret: true,
    botIds: [],
    createdAt: "2026-11-04T00:00:00Z",
  },
];
let machines: Record<string, unknown>[] = fresh();
const api = (path: string, method: string, body: Record<string, unknown> | undefined) => {
  if (method !== "GET") posts.push({ path, body: body ?? {} });
  if (path === "/api/computer/machines" && method === "GET") return { machines };
  if (path === "/api/bots") return { bots };
  if (path === "/api/connections/transport-key")
    return { kid: "k1", publicKey: pair.publicKey, userId: "me", serverTime: Date.now() };
  if (path === "/api/computer/machines/scan")
    return { keys: [{ type: "ssh-ed25519", key: HOST_KEY, fingerprint: FINGERPRINT }] };
  if (path === "/api/computer/machines" && method === "POST") {
    const made = {
      ...machines[0],
      id: "00000000-0000-7000-8000-0000000000b2",
      name: String(body?.name),
      kind: String(body?.kind),
      host: String(body?.host),
      port: 21,
      username: String(body?.username),
      fingerprint: null,
      botIds: body?.botIds,
    };
    machines = [...machines, made];
    return { machine: { ...made, publicKey: null } };
  }
  if (/^\/api\/computer\/machines\/[^/]+\/bots$/.test(path) && method === "PUT") {
    machines = machines.map((m) =>
      path.includes(String(m.id)) ? { ...m, botIds: body?.botIds } : m,
    );
    return { machine: machines[0] };
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
const press = async (label: string) => {
  const b = [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
/** Chooses a kind of access by its card (a radio). */
const chooseKind = async (kind: string) => {
  const radio = win.document.querySelector(
    `input[name="machine-kind"][value="${kind}"]`,
  ) as unknown as HTMLInputElement;
  await act(
    async () =>
      void radio.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event),
  );
  await settle();
};
/** Ticks or unticks a bot in a picker. */
const toggleBot = async (name: string, nth = 0) => {
  const box = [...win.document.querySelectorAll(`input[aria-label="${name}"]`)][
    nth
  ] as unknown as HTMLInputElement;
  await act(
    async () =>
      void box.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event),
  );
  await settle();
};
const submit = async () => {
  const form = win.document.querySelector('form[aria-label="Add a machine"]')!;
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();
};

const mount = async () => {
  const { MachinesPanel } = await import("./machines");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const errors: string[] = [];
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MachinesPanel onError={(m) => errors.push(m)} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { errors, unmount: () => act(async () => root.unmount()) };
};

test("each machine shows where it is, its pinned host key, and which bots may use it", async () => {
  machines = fresh();
  const { unmount, errors } = await mount();
  expect(text()).toContain("Web server");
  expect(text()).toContain("deploy@server.example.invalid:2222");
  expect(text()).toContain(FINGERPRINT);
  // Shared bots are drawn as bots; a machine nobody can use says so.
  expect(text()).toContain("Shared with");
  expect(text()).toContain("Ops");
  expect(text()).toContain("Not shared with any bot yet");
  // The form stays closed until asked for, and the explanation of who does what is always there.
  expect(win.document.querySelector('form[aria-label="Add a machine"]')).toBeNull();
  expect(text()).toContain("The bot never sees the key or password");
  expect(errors).toEqual([]);
  await unmount();
});

test("with no machine yet the form is already open", async () => {
  machines = [];
  const { unmount } = await mount();
  expect(win.document.querySelector('form[aria-label="Add a machine"]')).not.toBeNull();
  await unmount();
});

test("an FTP password leaves the page sealed for this purpose and never as plaintext, with the bots that were picked", async () => {
  machines = fresh();
  posts.length = 0;
  const { unmount, errors } = await mount();
  await press("Add a machine");
  await chooseKind("ftp");
  // Choosing FTP changes the explanation: no key, a password, and the warning about clear text.
  expect(text()).toContain("crosses the network as clear text");
  await type("name", "Files");
  await type("host", "files.example.invalid");
  await type("username", "bob");
  await type("secret", PASSWORD);
  await toggleBot("Ops");
  await toggleBot("Docs");
  await submit();

  const create = posts.find((p) => p.path === "/api/computer/machines");
  expect(errors).toEqual([]);
  expect(create).toBeDefined();
  expect(JSON.stringify(create!.body)).not.toContain(PASSWORD);
  expect(Object.keys(create!.body).sort()).toEqual([
    "botIds",
    "host",
    "kind",
    "name",
    "sealed",
    "username",
  ]);
  expect(create!.body).toMatchObject({
    name: "Files",
    kind: "ftp",
    host: "files.example.invalid",
    username: "bob",
    botIds: [OPS, DOCS],
  });
  expect(
    await open(
      pair.privateKey,
      create!.body.sealed as never,
      { userId: "me", purpose: "machine.create:ftp" },
      Date.now(),
    ),
  ).toEqual({ secret: PASSWORD });
  // The new machine is in the list, the form is closed again, and nothing secret is left on the page.
  expect(text()).toContain("bob@files.example.invalid:21");
  expect(text()).toContain("Added Files.");
  expect(win.document.querySelector('form[aria-label="Add a machine"]')).toBeNull();
  await unmount();
});

test("an SSH machine cannot be added before its host key is checked, and the person sees the fingerprint to compare", async () => {
  machines = fresh();
  posts.length = 0;
  const { unmount } = await mount();
  await press("Add a machine");
  const add = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Add machine",
  )!;
  expect(add.disabled).toBe(true);
  expect(text()).toContain("Check the host key first");
  await type("host", "server.example.invalid");
  await type("port", "2222");
  await press("Check host key");
  expect(posts.find((p) => p.path === "/api/computer/machines/scan")?.body).toEqual({
    host: "server.example.invalid",
    port: 2222,
  });
  expect(text()).toContain(`ssh-ed25519 ${FINGERPRINT}`);
  expect(add.disabled).toBe(false);
  await unmount();
});

test("sharing a machine with other bots changes the set for that machine only", async () => {
  machines = fresh();
  posts.length = 0;
  const { unmount, errors } = await mount();
  await press("Share");
  // The picker starts from who may use it now (Ops); the person adds Docs and saves.
  await toggleBot("Docs");
  await press("Save");
  const put = posts.find((p) => p.path === `/api/computer/machines/${WEB}/bots`);
  expect(errors).toEqual([]);
  expect(put?.body).toEqual({ botIds: [OPS, DOCS] });
  expect(text()).toContain("Web server is shared with 2 bots.");
  await unmount();
});
