import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Loaded after the DOM exists: react-dom picks its way of reading text inputs when it loads.
const loadRoot = async () => (await import("react-dom/client")).createRoot;
const calls: string[] = [];
const row = {
  id: "00000000-0000-7000-8000-0000000000b1",
  title: "Monthly report",
  language: "python",
  runner: "host",
  visibility: "team",
  ownerUserId: "someone",
  ownerName: "Ada",
  createdByBotId: null,
  version: 1,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
};
globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  calls.push(path);
  if (path.startsWith("/api/playgrounds?")) return Response.json({ playgrounds: [row] });
  if (path === "/api/playgrounds/languages") return Response.json({ languages: [] });
  return Response.json({ error: { code: "TEST", message: path } }, { status: 500 });
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

test("the address says whose playgrounds and what was searched: the page shows both with no click", async () => {
  const { PlaygroundsPage } = await import("./playgrounds-page");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = (await loadRoot())(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PlaygroundsPage
          search={{ scope: "team", q: "report" }}
          setSearch={() => {}}
          onOpen={() => {}}
          renderLink={(_id, children) => <span>{children}</span>}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();

  expect(calls).toContain("/api/playgrounds?scope=team&q=report");
  const pressed = [...win.document.querySelectorAll("button[aria-pressed='true']")].map(
    (b) => b.textContent,
  );
  expect(pressed).toEqual(["Shared with the team"]);
  expect(
    (win.document.querySelector('input[type="search"]') as unknown as HTMLInputElement).value,
  ).toBe("report");
  expect(win.document.body.textContent).toContain("Monthly report");
  expect(win.document.body.textContent).toContain("Ada ·");
  await act(async () => root.unmount());
});

test("typing in the search box changes the address after a pause, replacing the history entry", async () => {
  const { PlaygroundsPage } = await import("./playgrounds-page");
  const changes: { patch: unknown; replace: boolean | undefined }[] = [];
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = (await loadRoot())(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PlaygroundsPage
          search={{}}
          setSearch={(patch, options) => void changes.push({ patch, replace: options?.replace })}
          onOpen={() => {}}
          renderLink={(_id, children) => <span>{children}</span>}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();

  const box = win.document.querySelector('input[type="search"]') as unknown as HTMLInputElement;
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(box, " rep ");
  await act(async () => void box.dispatchEvent(new win.Event("input", { bubbles: true }) as never));
  expect(changes).toEqual([]);
  await act(async () => void (await new Promise((r) => setTimeout(r, 300))));

  expect(changes).toEqual([{ patch: { q: "rep" }, replace: true }]);
  await act(async () => root.unmount());
});
