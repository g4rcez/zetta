import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

// React DOM reads these globals. This test file does not run in a browser.
const win = new Window();
// CodeMirror reads `MutationObserver`, `getComputedStyle` and `requestAnimationFrame` as globals.
const globals = [
  "window",
  "document",
  "navigator",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "scrollTo",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
const saved = globals.map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
  scrollTo: () => {},
  IS_REACT_ACT_ENVIRONMENT: true,
});
// `src/env.ts` reads the app env once a window exists.
process.env.__VARLOCK_ENV = JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, VITE_SERVER_URL: { value: "http://api.test" } },
});
// Bun runs every test file in one process: leave the globals as they were.
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const ID = "00000000-0000-7000-8000-000000000001";
const TEAM = "00000000-0000-7000-8000-0000000000aa";
// The bot was "Dev" when the text was written and is "Leo" now.
const bots = [{ id: ID, name: "Leo", onboarded: true, kind: "bot" }] as never;

const render = async (element: unknown) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(element as never));
  return { host, unmount: () => act(async () => root.unmount()) };
};

test("the editor draws a mention token as a chip with the current name and keeps the token as its text", async () => {
  const { MentionField } = await import("./mention");
  const text = `Ask [@Dev](bot:${ID}) now`;
  const { host, unmount } = await render(
    <MentionField aria-label="Ask" value={text} onChange={() => {}} bots={bots} />,
  );
  expect(host.querySelector(".cm-mention")?.textContent).toBe("@Leo");
  await unmount();
});

test("a reply shows a mention token as a tag with the bot's current name, a team and a room as links", async () => {
  const { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } =
    await import("@tanstack/react-router");
  const { Response } = await import("./response");
  const { BotsContext } = await import("@/components/bot-identity");
  const text = `Hi [@Dev](bot:${ID}), see [#Core](team:${TEAM}) and [#Launch](room:${TEAM}).`;
  const root = createRootRoute({
    notFoundComponent: () => null,
    component: () => (
      <BotsContext.Provider value={new Map([[ID, { id: ID, name: "Leo" }]]) as never}>
        <Response text={text} />
        <Outlet />
      </BotsContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const { host, unmount } = await render(<RouterProvider router={router} />);
  const links = [...host.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
  expect(links).toEqual([
    ["@Leo", `/chat/new?bot=${ID}`],
    ["#Core", `/teams/${TEAM}/settings`],
    ["#Launch", `/rooms?id=${TEAM}`],
  ]);
  await unmount();
});
