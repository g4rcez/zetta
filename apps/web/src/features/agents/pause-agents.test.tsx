import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

// What the server says, and what the page sent to it.
let serverState: "running" | "paused" = "running";
const puts: unknown[] = [];
const patches: Record<string, unknown>[] = [];
// Same guard as app-shell.test.tsx: the auth client keeps the first `fetch` it sees for the whole test process, so once this file is
// done the fake hands every request to whatever `fetch` the next file installed.
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => void (finished = true));
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (url.pathname === "/api/preferences" && method === "PATCH") {
    patches.push(body);
    return Response.json({ preferences: {} });
  }
  if (url.pathname === "/api/preferences")
    return Response.json({
      preferences: {
        railMode: "expanded",
        sidebarSide: "left",
        railWidth: 224,
        listWidth: 320,
        timeFormat: "24h",
        approvalMode: "hold",
        theme: null,
        primaryColor: null,
        botOrder: [],
        agentsState: serverState,
      },
    });
  if (url.pathname === "/api/agents/state" && method === "PUT") {
    puts.push(body);
    serverState = body.state;
    return Response.json({ agentsState: serverState, stopped: serverState === "paused" ? 2 : 0 });
  }
  return Response.json({ error: { code: "TEST", message: "offline" } }, { status: 500 });
}) as typeof fetch;
globalThis.fetch = fake;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

async function mount() {
  const { ThemeProvider } = await import("../../components/theme-provider");
  const { PreferencesProvider, usePreferences } = await import("../preferences/preferences");
  const { PauseAgentsButton, PausedBanner } = await import("./pause-agents");
  // A consumer that changes a layout preference, to see what the provider sends to the server.
  function Collapse() {
    const { set } = usePreferences();
    return (
      <button type="button" id="collapse" onClick={() => set({ railMode: "collapsed" })}>
        collapse
      </button>
    );
  }
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ThemeProvider attribute="class" defaultTheme="light">
          <PreferencesProvider>
            <PausedBanner />
            <PauseAgentsButton collapsed={false} />
            <Collapse />
          </PreferencesProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
  const button = () => host.querySelector("button[aria-pressed]") as unknown as HTMLButtonElement;
  const banner = () => host.querySelector('[role="status"]');
  return { host, button, banner, unmount: () => act(async () => root.unmount()) };
}

test("running agents: no banner, a Pause button, and pressing it pauses and shows the banner", async () => {
  serverState = "running";
  puts.length = 0;
  const { button, banner, unmount } = await mount();
  expect(banner()).toBeNull();
  expect(button().getAttribute("aria-label")).toBe("Pause agents");
  expect(button().getAttribute("aria-pressed")).toBe("false");
  await act(async () => button().click());
  await settle();
  expect(puts).toEqual([{ state: "paused" }]);
  expect(button().getAttribute("aria-label")).toBe("Resume agents");
  expect(button().getAttribute("aria-pressed")).toBe("true");
  expect(banner()?.textContent).toContain("Your agents are paused");
  await unmount();
});

test("paused agents (as the server says): the banner is there from the first render, and Resume brings them back", async () => {
  serverState = "paused";
  puts.length = 0;
  const { host, banner, unmount } = await mount();
  expect(banner()?.textContent).toContain("Your agents are paused");
  const resume = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Resume agents"),
  )!;
  await act(async () => (resume as unknown as HTMLButtonElement).click());
  await settle();
  expect(puts).toEqual([{ state: "running" }]);
  expect(banner()).toBeNull();
  await unmount();
});

test("saving a layout preference never sends the agents state: the server refuses it in a patch", async () => {
  serverState = "paused";
  patches.length = 0;
  const { host, unmount } = await mount();
  await act(async () => (host.querySelector("#collapse") as unknown as HTMLButtonElement).click());
  // The provider saves after a short pause.
  await act(async () => void (await new Promise((r) => setTimeout(r, 600))));
  expect(patches).toEqual([{ railMode: "collapsed" }]);
  await unmount();
});
