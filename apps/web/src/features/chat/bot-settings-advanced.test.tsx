import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Bun's own FormData cannot read a DOM form; the form of the general settings is read on submit.
const BunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = BunFormData;
});

let navMode: "simple" | "full" = "simple";
const patches: Record<string, unknown>[] = [];
// Before anything that loads the auth client: it keeps the `fetch` it finds at load time.
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (init?.method === "PATCH" && url.pathname.startsWith("/api/bots/")) {
    const body = JSON.parse(String(init.body));
    patches.push(body.patch);
    return Response.json({ bot: { ...BOT, ...body.patch, version: 2 } });
  }
  return Response.json({ preferences: { navMode } });
}) as unknown as typeof fetch;

const BOT = {
  id: "00000000-0000-7000-8000-0000000000a1",
  kind: "specialist",
  name: "Tess",
  role: "",
  description: "Answers billing questions.\nSecond line.",
  harness: "claude-code",
  model: null,
  fallbackHarness: null,
  fallbackModel: null,
  version: 1,
  canEdit: true,
  visibility: "team",
  onboarded: true,
};

const { GeneralForm } = await import("./bot-settings");
const { EngineStep, IdentityStep } = await import("../bots/bot-onboarding");
const { PreferencesProvider } = await import("../preferences/preferences");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
  win.localStorage.clear();
  patches.length = 0;
});
const settle = (ms = 40) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function mount(mode: "simple" | "full", node: React.ReactNode) {
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

const general = () => (
  <GeneralForm
    bot={BOT as never}
    bots={[BOT as never]}
    spaces={[]}
    onBotChange={() => {}}
    notify={() => {}}
  />
);
const draft = {
  name: "Tess",
  role: "",
  description: "Answers billing questions.",
  harness: "claude-code",
  model: "",
  personality: "",
  instructions: "",
  outputStyle: "default" as const,
  outputStyleId: null,
  visibility: "team" as const,
};
const engine = () => <EngineStep draft={draft} set={() => {}} />;

/** The closest fold around the control that carries this label. */
function foldOf(host: Element, label: string) {
  const hit = [...host.querySelectorAll("label, legend, span, p, h3")].find(
    (n) => n.textContent?.trim() === label,
  );
  if (!hit) throw new Error(`no "${label}" in: ${host.textContent?.slice(0, 400)}`);
  return hit.closest("details") as unknown as HTMLDetailsElement | null;
}

test("bot settings, simple view: engine, model and fallback sit in a closed Advanced fold", async () => {
  const host = await mount("simple", general());
  for (const label of ["Harness", "Model", "Fallback harness"]) {
    const fold = foldOf(host, label);
    expect(fold).not.toBeNull();
    expect(fold!.open).toBe(false);
    expect(fold!.querySelector("summary")!.textContent).toContain("Advanced");
  }
  // The everyday fields stay out of the fold.
  expect(foldOf(host, "Name")).toBeNull();
  expect(foldOf(host, "Role")).toBeNull();
  expect(foldOf(host, "Description")).toBeNull();
});

test("bot settings, full view: the same controls are open", async () => {
  const host = await mount("full", general());
  for (const label of ["Harness", "Model", "Fallback harness"])
    expect(foldOf(host, label)!.open).toBe(true);
});

test("a folded engine is still saved with the form, and the role goes with it", async () => {
  const host = await mount("simple", general());
  const role = host.querySelector('[name="role"]') as HTMLInputElement;
  expect(role.maxLength).toBe(60);
  // With no role written, the field shows the line the pickers would show: the first line of the description.
  expect(role.placeholder).toBe("Answers billing questions.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      role,
      "  Support lead ",
    );
    role.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never);
  });
  await settle();
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({ role: "Support lead", harness: "claude-code" });
});

test("new bot wizard, simple view: the recommended engines show, the other engines and the model are folded", async () => {
  const host = await mount("simple", engine());
  const text = host.textContent ?? "";
  expect(text).toContain("Claude Code");
  expect(text).toContain("Recommended");
  const recommended = host.querySelector('input[name="harness"][value="claude-code"]')!;
  expect(recommended.closest("details")).toBeNull();
  const unverified = foldOf(host, "Not fully verified");
  expect(unverified!.open).toBe(false);
  expect(foldOf(host, "Model")).toBe(unverified);
});

test("new bot wizard, full view: they are open", async () => {
  const host = await mount("full", engine());
  expect(foldOf(host, "Not fully verified")!.open).toBe(true);
});

test("the identity step has a Role field with its hint", async () => {
  const host = await mount(
    "simple",
    <IdentityStep draft={draft} set={() => {}} avatar={null} setAvatar={() => {}} />,
  );
  const role = host.querySelector("input[maxlength='60']") as HTMLInputElement;
  expect(role).not.toBeNull();
  expect(role.placeholder).toBe("Answers billing questions.");
  expect(host.textContent).toContain("What this bot does for the team, e.g. Support lead");
});
