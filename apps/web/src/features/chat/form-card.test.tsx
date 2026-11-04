import { expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "@/lib/query-client";
import { setupDom } from "../skills/dom-env";

// The installation API writes the saved answer to the app's own cache, so the test mounts with that same client.
const withQuery = (element: unknown) => (
  <QueryClientProvider client={queryClient}>{element as never}</QueryClientProvider>
);

const win = setupDom();
// happy-dom has no ResizeObserver, which the error Alert of the component library reads.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

let installation = {
  networkMode: "local",
  // A saved address from an earlier choice: switching the mode brings it back, so the test needs no typing.
  publicUrl: "https://zetta.example.invalid" as string | null,
  onboarding: "done",
  laya: "off",
  layaLanguages: ["en"],
  layaModel: "english",
  restartRequired: false,
};
let patches: unknown[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  if (path === "/api/installation" && (init?.method ?? "GET") === "GET")
    return Response.json(installation);
  if (path === "/api/installation" && init?.method === "PATCH") {
    const body = JSON.parse(String(init.body));
    patches.push(body);
    installation = { ...installation, ...body, restartRequired: true };
    return Response.json(installation);
  }
  return Response.json({ error: { code: "UNAUTHENTICATED", message: "no" } }, { status: 401 });
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
const typeInto = async (target: unknown, value: string) => {
  const el = target as HTMLElement;
  // React tracks the value it last saw on the node itself; the prototype setter changes it without telling that tracker.
  const proto =
    el instanceof win.HTMLSelectElement
      ? win.HTMLSelectElement.prototype
      : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => void el.dispatchEvent(new win.Event("input", { bubbles: true }) as never));
  await act(async () => void el.dispatchEvent(new win.Event("change", { bubbles: true }) as never));
};
const click = (target: unknown) =>
  act(
    async () =>
      void (target as HTMLElement).dispatchEvent(
        new win.MouseEvent("click", { bubbles: true }) as never,
      ),
  );

test("the installation card shows the network choice, asks for the address, saves it and says a restart is needed", async () => {
  const { FormCard } = await import("./form-card");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      withQuery(
        <FormCard data={{ form: "installation", botId: null, botName: null, prefill: {} }} />,
      ),
    ),
  );
  await settle();
  expect(host.textContent).toContain("Installation settings");
  expect(host.textContent).toContain("Only this computer");
  expect(host.textContent).not.toContain("Public address");

  const select = [...host.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === "network"),
  )!;
  expect(select).toBeDefined();
  await typeInto(select, "network");
  expect(host.textContent).toContain("Public address");
  const save = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Save network"))!;
  expect((host.querySelector('input[type="url"]') as unknown as HTMLInputElement).value).toBe(
    "https://zetta.example.invalid",
  );
  expect(save().disabled).toBe(false);
  await click(save());
  await settle();

  expect(patches).toEqual([{ networkMode: "network", publicUrl: "https://zetta.example.invalid" }]);
  expect(host.textContent).toContain("Restart the Zetta server to apply the network choice.");
  await act(async () => root.unmount());
});
