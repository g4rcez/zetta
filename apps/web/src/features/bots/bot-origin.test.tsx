import { afterAll, expect, test } from "bun:test";
import { act } from "react";

import type { BotOrigin } from "../chat/chat-client";
import { setupDom } from "../skills/dom-env";

const win = setupDom();
afterAll(() => {});

const origin: BotOrigin = {
  source: "grok_marketplace",
  url: "https://x.ai/bot/marketplace/bots/example-bot",
  slug: "example-bot",
  creator: "Example Creator",
  handle: "example",
  importedAt: "2026-11-09T12:00:00.000Z",
  integrations: [
    { name: "Google Calendar", description: "Reads events.", pluginId: "google" },
    { name: "Ramp", description: "Reads card spend.", pluginId: null },
  ],
};

async function mount(o: BotOrigin) {
  win.document.body.replaceChildren();
  const { createRoot } = await import("react-dom/client");
  const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { BotOriginSection } = await import("./bot-origin");
  const root = createRootRoute({ component: () => <BotOriginSection origin={o} /> });
  const plugin = createRoute({ getParentRoute: () => root, path: "/plugins/$pluginId" });
  const router = createRouter({
    routeTree: root.addChildren([plugin]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const r = createRoot(host as unknown as Element);
  await act(async () => r.render(<RouterProvider router={router} />));
  await act(async () => void (await new Promise((res) => setTimeout(res, 30))));
  return host;
}

test("credits the creator and links to the original in a new tab", async () => {
  const host = await mount(origin);
  expect(host.textContent).toContain(
    "Imported from the Grok Bot marketplace, made by Example Creator",
  );
  expect(host.textContent).toContain("November");
  const link = [...host.querySelectorAll("a")].find((a) => a.textContent === "See the original")!;
  expect(link.getAttribute("href")).toBe("https://x.ai/bot/marketplace/bots/example-bot");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("an app with a Zetta plugin links to it inside the app; one without says so", async () => {
  const host = await mount(origin);
  const setup = [...host.querySelectorAll("a")].find((a) => a.textContent === "Set up google")!;
  expect(setup.getAttribute("href")).toBe("/plugins/google");
  expect(setup.getAttribute("target")).toBeNull();
  expect(host.textContent).toContain("Ramp");
  expect(host.textContent).toContain("No Zetta equivalent");
});

test("a bot that needs nothing outside shows no list, and a missing creator is named plainly", async () => {
  const host = await mount({ ...origin, creator: "", integrations: [] });
  expect(host.textContent).toContain("made by an unknown creator");
  expect(host.textContent).not.toContain("It was built to use");
});
