import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const ROUTINE = "00000000-0000-7000-8000-000000000001";
const WEBHOOK = "00000000-0000-7000-8000-0000000000a1";
const GMAIL = "00000000-0000-7000-8000-0000000000a2";
const calls: { path: string; method: string; body: unknown }[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  const method = init?.method ?? "GET";
  calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (path === `/api/routines/${ROUTINE}/triggers` && method === "GET")
    return Response.json({
      triggers: [
        { id: WEBHOOK, kind: "webhook", filter: {}, status: "active", statusReason: null },
        {
          id: GMAIL,
          kind: "gmail",
          filter: { query: "from:billing" },
          status: "failing",
          statusReason: "Google is not connected. Connect it in Studio.",
        },
      ],
    });
  if (path === `/api/routines/${ROUTINE}/triggers` && method === "POST")
    return Response.json(
      { trigger: { id: WEBHOOK, kind: "webhook" }, secret: "zrt_example-secret" },
      { status: 201 },
    );
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const mount = async (paused: boolean) => {
  const { RoutineTriggers } = await import("./routine-triggers");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RoutineTriggers routineId={ROUTINE} paused={paused} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => void (await new Promise((ok) => setTimeout(ok, 30))));
  return { host, unmount: () => act(async () => root.unmount()) };
};
const buttons = (host: unknown) =>
  [...(host as HTMLElement).querySelectorAll("button")] as unknown as HTMLButtonElement[];

test("each trigger shows what starts the routine, its state and why it stopped", async () => {
  const { host, unmount } = await mount(false);
  expect(host.textContent).toContain("Webhook");
  expect(host.textContent).toContain("/api/routines/hook/00000000-0000-7000-8000-0000000000a1");
  expect(host.textContent).toContain('A new mail that matches "from:billing"');
  expect(host.textContent).toContain("Stopped");
  expect(host.textContent).toContain("Google is not connected. Connect it in Studio.");
  await unmount();
});

test("a paused routine says its triggers do nothing yet", async () => {
  const { host, unmount } = await mount(true);
  expect(host.textContent).toContain("so its triggers do nothing until you activate it");
  await unmount();
});

test("adding a webhook shows its secret once, with a curl example", async () => {
  const { host, unmount } = await mount(false);
  const addWebhook = buttons(host).find((b) => b.textContent === "Add: Webhook")!;
  await act(async () => addWebhook.click());
  const form = host.querySelector("form") as unknown as HTMLFormElement;
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await act(async () => void (await new Promise((ok) => setTimeout(ok, 30))));
  expect(
    calls.some((c) => c.method === "POST" && JSON.stringify(c.body) === '{"kind":"webhook"}'),
  ).toBe(true);
  expect(host.textContent).toContain("Copy the secret now. It is not shown again.");
  expect(host.textContent).toContain("Authorization: Bearer zrt_example-secret");
  await unmount();
});

test("a run says what started it", async () => {
  const { runOrigin } = await import("./routine-triggers");
  expect(runOrigin({ trigger: "manual" })).toBe("started by you");
  expect(runOrigin({ trigger: "schedule" })).toBe("scheduled");
  expect(runOrigin({ trigger: "recovery" })).toBe("retried after a failure");
  expect(runOrigin({ trigger: "webhook", event: { order: 1 } })).toBe("started by a webhook");
  expect(runOrigin({ trigger: "event", event: { source: "gmail", subject: "Invoice 42" } })).toBe(
    "new mail: Invoice 42",
  );
  expect(
    runOrigin({
      trigger: "event",
      event: {
        source: "home_assistant",
        name: "Kitchen light",
        entityId: "light.kitchen",
        to: "on",
      },
    }),
  ).toBe("Kitchen light changed to on");
});

test("a very long subject from outside is cut short", async () => {
  const { runOrigin } = await import("./routine-triggers");
  const text = runOrigin({
    trigger: "event",
    event: { source: "gmail", subject: "x".repeat(500) },
  });
  expect(text).toBe(`new mail: ${"x".repeat(80)}…`);
});
