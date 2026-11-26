import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const workspace = (id: string, name: string, more: object = {}) => ({
  id,
  slug: name.toLowerCase(),
  name,
  status: "active",
  createdAt: "2030-01-01T00:00:00.000Z",
  people: 3,
  own: false,
  usage: { runs: 12, runSeconds: 600 },
  quota: { runsPerMonth: null, runSecondsPerMonth: null },
  ...more,
});
let listed: ReturnType<typeof workspace>[] = [];
const sent: { method: string; path: string; body: unknown }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (method !== "GET" || url.pathname === "/api/workspace/export")
    sent.push({ method, path: `${url.pathname}${url.search}`, body });
  if (url.pathname === "/api/workspace/operator") return Response.json({ workspaces: listed });
  if (url.pathname === "/api/workspace/export")
    return new Response(new Uint8Array([31, 139]), {
      headers: { "content-disposition": 'attachment; filename="acme-2030-01-01.ndjson.gz"' },
    });
  return Response.json({});
}) as typeof fetch;

const settle = (ms = 80) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";
const buttons = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);
const click = async (target: unknown) => {
  await act(async () => void (target as HTMLElement).click());
  await settle();
};
const fill = (scope: ParentNode, name: string, value: string) =>
  act(async () => {
    const input = scope.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });

let root: ReturnType<typeof createRoot> | undefined;
async function mount(which: "operator" | "download") {
  const { OperatorPanel, DownloadWorkspace } = await import("./operator-panel");
  const { queryClient } = await import("@/lib/query-client");
  queryClient.clear();
  const host = win.document.createElement("div") as unknown as Element;
  (win.document.body as unknown as Element).append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        {which === "operator" ? <OperatorPanel /> : <DownloadWorkspace />}
      </QueryClientProvider>,
    ),
  );
  await settle(120);
}
const row = (name: string) =>
  win.document.querySelector(`li[aria-label="${name}"]`) as unknown as HTMLElement;

beforeEach(() => {
  listed = [
    workspace("w1", "Main", { own: true }),
    workspace("w2", "Acme", {
      quota: { runsPerMonth: 10, runSecondsPerMonth: 3600 },
      usage: { runs: 10, runSeconds: 1200 },
    }),
  ];
  sent.length = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  win.document.body.replaceChildren();
});

test("root sees every workspace's people and month against its limits, and which one is root's own", async () => {
  await mount("operator");
  expect(row("Main").textContent).toContain("Yours");
  expect(row("Main").textContent).toContain("Runs this month: 12");
  expect(row("Acme").textContent).toContain("Runs this month: 10 of 10");
  expect(row("Acme").textContent).toContain("Limit reached");
  expect(row("Acme").textContent).toContain("Minutes this month: 20 of 60");
  // Root's own workspace is never suspended or deleted.
  expect(buttons(row("Main"), "Suspend")).toHaveLength(0);
  expect(buttons(row("Main"), "Delete")).toHaveLength(0);
});

test("limits are saved as a month's runs and minutes, empty for none; a word is refused before anything is sent", async () => {
  await mount("operator");
  await fill(row("Acme"), "runs", "500");
  await fill(row("Acme"), "minutes", "");
  await act(
    async () =>
      void row("Acme")
        .querySelector("form")!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();
  expect(sent).toEqual([
    {
      method: "PUT",
      path: "/api/workspace/operator/w2/quota",
      body: { runsPerMonth: 500, runSecondsPerMonth: null },
    },
  ]);
  await fill(row("Acme"), "minutes", "lots");
  await act(
    async () =>
      void row("Acme")
        .querySelector("form")!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();
  expect(sent).toHaveLength(1);
  expect(row("Acme").textContent).toContain("A limit is a whole number");
});

test("root suspends a workspace, and deletes one only after saying yes", async () => {
  await mount("operator");
  await click(buttons(row("Acme"), "Suspend")[0]);
  expect(sent.at(-1)).toMatchObject({
    method: "PUT",
    path: "/api/workspace/operator/w2/status",
    body: { status: "suspended" },
  });
  await click(buttons(row("Acme"), "Delete")[0]);
  expect(sent.some((s) => s.method === "DELETE")).toBe(false);
  expect(text()).toContain("cannot be undone");
  await click(buttons(win.document, "Delete workspace")[0]);
  expect(sent.at(-1)).toMatchObject({ method: "DELETE", path: "/api/workspace/operator/w2" });
});

test("an owner downloads a copy of the workspace they work in", async () => {
  const made: string[] = [];
  Object.assign(win.URL, {
    createObjectURL: () => "blob:copy",
    revokeObjectURL: () => {},
  });
  globalThis.URL.createObjectURL = () => "blob:copy";
  const click_ = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    made.push(this.download);
  };
  try {
    await mount("download");
    await click(buttons(win.document, "Download a copy")[0]);
    expect(sent).toEqual([{ method: "GET", path: "/api/workspace/export", body: null }]);
    expect(made).toEqual(["acme-2030-01-01.ndjson.gz"]);
  } finally {
    win.HTMLAnchorElement.prototype.click = click_;
  }
});
