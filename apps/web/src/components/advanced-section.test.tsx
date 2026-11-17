import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

let navMode: "simple" | "full" | null = "simple";
// Before anything that loads the auth client: it keeps the `fetch` it finds at load time.
globalThis.fetch = (async () =>
  navMode
    ? Response.json({ preferences: { navMode } })
    : Response.json({ message: "signed out" }, { status: 401 })) as unknown as typeof fetch;

const { AdvancedSection } = await import("./advanced-section");
const { PreferencesProvider } = await import("../features/preferences/preferences");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
  win.localStorage.clear();
});

const settle = (ms = 40) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function mount(mode: "simple" | "full" | null, node: React.ReactNode = <Section />) {
  navMode = mode;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PreferencesProvider>{node}</PreferencesProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
  return host as unknown as Element;
}

function Section(props: { defaultOpen?: boolean; title?: string }) {
  return (
    <AdvancedSection {...props}>
      <p>Engine and model</p>
    </AdvancedSection>
  );
}

const details = (host: Element) => host.querySelector("details") as unknown as HTMLDetailsElement;

test("a person in the simple view sees it folded, with the title as its name", async () => {
  const host = await mount("simple");
  expect(details(host).open).toBe(false);
  const summary = host.querySelector("summary")!;
  expect(summary.textContent).toContain("Advanced");
  expect(summary.querySelector("svg")).not.toBeNull();
  expect(host.textContent).toContain("Engine and model");
});

test("a person in the full view sees it open", async () => {
  const host = await mount("full");
  expect(details(host).open).toBe(true);
});

test("before the preferences are known, or signed out, it is folded", async () => {
  expect(details(await mount(null)).open).toBe(false);
  win.document.body.replaceChildren();
  const bare = win.document.createElement("div");
  win.document.body.append(bare);
  const root = createRoot(bare as unknown as Element);
  roots.push(root);
  await act(async () => root.render(<Section />));
  expect(details(bare as unknown as Element).open).toBe(false);
});

test("defaultOpen overrides the view, both ways, and the title can change", async () => {
  expect(details(await mount("simple", <Section defaultOpen />)).open).toBe(true);
  win.document.body.replaceChildren();
  const host = await mount("full", <Section defaultOpen={false} title="More options" />);
  expect(details(host).open).toBe(false);
  expect(host.querySelector("summary")!.textContent).toContain("More options");
});

test("a click on the title opens it, a second click folds it", async () => {
  const host = await mount("simple");
  const summary = host.querySelector("summary") as unknown as HTMLElement;
  const click = () =>
    act(async () => {
      summary.dispatchEvent(
        new win.MouseEvent("click", { bubbles: true, cancelable: true }) as never,
      );
    });
  await click();
  await settle();
  expect(details(host).open).toBe(true);
  await click();
  await settle();
  expect(details(host).open).toBe(false);
});

test("a choice made by the person is kept", async () => {
  const host = await mount("simple");
  await act(async () => {
    details(host).open = true;
    details(host).dispatchEvent(new win.Event("toggle") as never);
  });
  await settle();
  expect(details(host).open).toBe(true);
});
