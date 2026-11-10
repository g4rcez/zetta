import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
afterEach(() => {
  win.document.body.innerHTML = "";
});

const html = '<!doctype html><html><head></head><body><button id="b">Add</button></body></html>';
const sent: { path: string; method: string; body: any }[] = [];
let callResult: any;
let answerResult: any = { status: "ok", callId: "c1", value: { removed: "7" }, durationMs: 2 };
let failUi = false;

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  sent.push({ path, method, body });
  if (path === "/api/apps/todo/ui")
    return failUi
      ? Response.json(
          { error: { code: "NOT_FOUND", message: "To do has no page." } },
          { status: 404 },
        )
      : Response.json({
          page: {
            app: "todo",
            name: "To do",
            version: 2,
            html,
            tools: [
              { name: "items.list", kind: "query", description: "List" },
              { name: "items.remove", kind: "mutation", description: "Remove" },
            ],
          },
        });
  if (path === "/api/apps/todo/call") return Response.json({ result: callResult(body) });
  if (path.startsWith("/api/app-calls/")) return Response.json({ result: answerResult });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
const frame = () => win.document.querySelector("iframe") as unknown as HTMLIFrameElement;
const buttons = () => [...win.document.querySelectorAll("button")];

const mount = async () => {
  const { AppFrame } = await import("./app-frame");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AppFrame appRef="todo" />
      </QueryClientProvider>,
    ),
  );
  await settle();
  // Replies to the page arrive as `message` events on the frame's window.
  const replies: any[] = [];
  frame().contentWindow?.addEventListener("message", (e: any) => void replies.push(e.data));
  /** A message as the browser delivers it: from the frame's window. */
  const fromFrame = async (data: unknown, source: unknown = frame().contentWindow) => {
    await act(async () => {
      win.dispatchEvent(new (win as any).MessageEvent("message", { data, source }));
    });
    await settle();
  };
  return { replies, fromFrame, unmount: () => act(async () => root.unmount()) };
};
const req = (over: Record<string, unknown> = {}) => ({
  source: "zetta-app",
  id: 1,
  type: "call",
  tool: "items.list",
  ...over,
});

test("the page is drawn in a frame that can run scripts and nothing else, under the closed-network policy", async () => {
  sent.length = 0;
  failUi = false;
  const { unmount } = await mount();
  const f = frame();
  // Scripts and forms (a page's own submit handler); `form-action 'none'` in the policy keeps forms from going anywhere.
  expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
  expect(f.getAttribute("csp")).toContain("connect-src 'none'");
  expect(f.getAttribute("srcdoc")).toBe(html);
  expect(f.getAttribute("title")).toBe("To do");
  await unmount();
});

test("a page that cannot be loaded says why", async () => {
  failUi = true;
  const { unmount } = await mount().catch(() => ({ unmount: async () => {} }));
  expect(text()).toContain("To do has no page.");
  failUi = false;
  await unmount();
});

test("a call from the frame goes to the server as the person and the value goes back to the frame", async () => {
  failUi = false;
  sent.length = 0;
  callResult = () => ({ status: "ok", callId: "c", value: [{ id: 1 }], durationMs: 3 });
  const { replies, fromFrame, unmount } = await mount();
  await fromFrame(req({ id: 5, input: { q: "x" } }));
  expect(sent.find((r) => r.path === "/api/apps/todo/call")?.body).toEqual({
    tool: "items.list",
    input: { q: "x" },
  });
  expect(replies).toEqual([{ source: "zetta-host", id: 5, ok: true, value: [{ id: 1 }] }]);
  await unmount();
});

test("a message from anything but the frame's own window is ignored", async () => {
  failUi = false;
  sent.length = 0;
  callResult = () => ({ status: "ok", callId: "c", value: 1, durationMs: 1 });
  const { replies, fromFrame, unmount } = await mount();
  await fromFrame(req(), win);
  await fromFrame(req(), null);
  await fromFrame(req(), { not: "a window" });
  expect(sent.some((r) => r.path.endsWith("/call"))).toBe(false);
  expect(replies).toEqual([]);
  await unmount();
});

test("a tool the app does not have is refused to the frame and does not reach the server", async () => {
  failUi = false;
  sent.length = 0;
  const { replies, fromFrame, unmount } = await mount();
  await fromFrame(req({ tool: "items.drop" }));
  expect(replies).toMatchObject([{ ok: false, error: { code: "UNKNOWN_TOOL" } }]);
  expect(sent.some((r) => r.path.endsWith("/call"))).toBe(false);
  await unmount();
});

test("a change is asked in a bar outside the frame with the tool and the exact input; Allow runs it and the frame gets the answer", async () => {
  failUi = false;
  sent.length = 0;
  callResult = () => ({
    status: "approval_required",
    callId: "c1",
    app: "todo",
    tool: "items.remove",
    kind: "mutation",
    input: { id: "7" },
    reason: "A tool that changes something asks first.",
  });
  const { replies, fromFrame, unmount } = await mount();
  await fromFrame(req({ id: 2, tool: "items.remove", input: { id: "7" } }));
  const bar = win.document.querySelector('[role="alertdialog"]')!;
  expect(bar).not.toBeNull();
  // The bar belongs to Zetta, not to the page: it is not inside the frame's container element.
  expect(bar.contains(frame() as never)).toBe(false);
  expect(bar.textContent).toContain("To do");
  expect(bar.textContent).toContain("items.remove");
  expect(bar.textContent).toContain("Changes something");
  expect(bar.textContent).toContain('"id": "7"');
  expect(sent.some((r) => r.path.startsWith("/api/app-calls/"))).toBe(false);
  expect(replies).toEqual([]);
  await act(
    async () =>
      void buttons()
        .find((b) => b.textContent === "Allow")!
        .dispatchEvent(new win.MouseEvent("click", { bubbles: true })),
  );
  await settle();
  expect(sent.find((r) => r.path === "/api/app-calls/c1/answer")?.body).toEqual({
    action: "accept",
  });
  expect(replies).toEqual([{ source: "zetta-host", id: 2, ok: true, value: { removed: "7" } }]);
  expect(win.document.querySelector('[role="alertdialog"]')).toBeNull();
  await unmount();
});

test("Decline tells the server no and the frame that the person declined", async () => {
  failUi = false;
  sent.length = 0;
  callResult = () => ({
    status: "approval_required",
    callId: "c2",
    app: "todo",
    tool: "items.remove",
    kind: "mutation",
    input: { id: "9" },
    reason: "x",
  });
  const { replies, fromFrame, unmount } = await mount();
  await fromFrame(req({ id: 3, tool: "items.remove", input: { id: "9" } }));
  await act(
    async () =>
      void buttons()
        .find((b) => b.textContent === "Decline")!
        .dispatchEvent(new win.MouseEvent("click", { bubbles: true })),
  );
  await settle();
  expect(sent.find((r) => r.path === "/api/app-calls/c2/answer")?.body).toEqual({
    action: "decline",
  });
  expect(replies).toMatchObject([{ id: 3, ok: false, error: { code: "DECLINED" } }]);
  await unmount();
});

test("closing the page cancels a prompt that is still open", async () => {
  failUi = false;
  sent.length = 0;
  callResult = () => ({
    status: "approval_required",
    callId: "c3",
    app: "todo",
    tool: "items.remove",
    kind: "mutation",
    input: {},
    reason: "x",
  });
  const { fromFrame, unmount } = await mount();
  await fromFrame(req({ tool: "items.remove" }));
  expect(win.document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await unmount();
  await settle();
  expect(sent.find((r) => r.path === "/api/app-calls/c3/answer")?.body).toEqual({
    action: "cancel",
  });
});
