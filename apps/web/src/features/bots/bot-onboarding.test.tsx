import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { BOT_TEMPLATES, templateById } from "./bot-templates";

const win = setupDom();
(globalThis as { scrollTo?: () => void }).scrollTo = () => {};
afterAll(() => {
  delete (globalThis as { scrollTo?: () => void }).scrollTo;
});

let claudeStatus: "ready" | "needs_login" = "ready";
let posts: Record<string, unknown>[] = [];
let catalogIds = ["context7", "github"];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const ok = (v: unknown, status = 200) => Response.json(v, { status });
  if (url.pathname === "/api/bots" && method === "POST") {
    posts.push(body);
    return ok(
      {
        bot: {
          ...body,
          id: "00000000-0000-7000-8000-000000000009",
          version: 1,
          kind: "specialist",
          canEdit: true,
        },
      },
      201,
    );
  }
  if (url.pathname === "/api/bots") return ok({ bots: [] });
  if (url.pathname === "/api/conversations") return ok({ conversations: [] });
  if (url.pathname === "/api/folders") return ok({ folders: [] });
  if (url.pathname === "/api/harnesses")
    return ok({
      harnesses: [
        {
          harness: "claude-code",
          label: "Claude Code",
          installed: true,
          status: claudeStatus,
          perUserLogin: false,
        },
      ],
    });
  if (url.pathname === "/api/plugins/catalog")
    return ok({
      plugins: catalogIds.map((id) => ({ id, name: id === "github" ? "GitHub" : "Context7" })),
    });
  if (url.pathname === "/api/plugins") return ok({ plugins: [] });
  return ok({ error: { code: "TEST", message: `unexpected ${method} ${url.pathname}` } }, 500);
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";
const press = async (label: string) => {
  const b = [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${text().slice(0, 600)}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const pick = async (id: string) => {
  const radio = win.document.querySelector(`input[name="origin"][value="${id}"]`);
  if (!radio) throw new Error(`no card for ${id}`);
  await act(async () => void radio.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};

async function mount() {
  posts = [];
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { SidebarDataProvider } = await import("../chat/sidebar-data");
  const { BotOnboarding } = await import("./bot-onboarding");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SidebarDataProvider>
            <BotOnboarding />
          </SidebarDataProvider>
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  return () => act(async () => root.unmount());
}

test("the gallery shows every template with its title, description and picture", async () => {
  const unmount = await mount();
  for (const t of BOT_TEMPLATES) {
    const card = win.document
      .querySelector(`input[name="origin"][value="${t.id}"]`)
      ?.closest("label");
    expect(card, t.id).toBeTruthy();
    expect(card!.textContent).toContain(t.title);
    expect(card!.textContent).toContain(t.description);
    // The picture the bot will get, not a stand-in icon.
    expect(card!.querySelector("svg"), `${t.id} picture`).toBeTruthy();
  }
  // Grouped by what the bot is for.
  for (const label of [
    "Research & data",
    "Engineering",
    "Writing & learning",
    "People & operations",
  ])
    expect(text()).toContain(label);
  await unmount();
});

test("choosing a template shows what it sets up and offers both ways on", async () => {
  const unmount = await mount();
  expect(text()).not.toContain("Customize first");
  await pick("researcher");
  const t = templateById("researcher")!;
  expect(text()).toContain("Create Researcher");
  expect(text()).toContain("Customize first");
  expect(text()).toContain("Runs on Claude Code.");
  expect(text()).toContain("Computer use");
  expect(text()).toContain("Browser");
  expect(text()).toContain(t.starters[0]!);
  await unmount();
});

test("Create now makes the bot exactly as the template says, with its picture and settings", async () => {
  const unmount = await mount();
  await pick("researcher");
  await press("Create Researcher");
  expect(posts).toHaveLength(1);
  const t = templateById("researcher")!;
  expect(posts[0]).toMatchObject({
    name: "Researcher",
    description: t.description,
    avatar: t.avatar,
    personality: t.personality,
    instructions: t.instructions,
    outputStyle: "default",
    computerMode: "browser",
    codeAccess: false,
    harness: "claude-code",
  });
  // No suggested plugins for this one: it goes straight to the test drive.
  expect(text()).toContain("Take it for a test drive");
  expect(text()).toContain(t.starters[1]!);
  await unmount();
});

test("a code template gets code access, then the plugins it works well with", async () => {
  const unmount = await mount();
  await pick("engineer");
  await press("Create Software engineer");
  expect(posts[0]).toMatchObject({
    name: "Software engineer",
    codeAccess: true,
    computerMode: "off",
    outputStyle: "concise",
  });
  expect(text()).toContain("Which tools may it use?");
  expect(text()).toContain("works well with");
  expect(text()).toContain("Context7");
  await unmount();
});

test("Customize carries the template into the wizard, and the edited bot still keeps its settings", async () => {
  const unmount = await mount();
  await pick("researcher");
  await press("Customize");
  expect(text()).toContain("Who is this bot?");
  // The name starts from the template's title; change something else the person can edit here.
  const nameField = win.document.querySelector('input[maxlength="80"]') as unknown as
    | HTMLInputElement
    | undefined;
  expect(nameField?.value).toBe("Researcher");
  const priv = win.document.querySelector('input[name="visibility"][value="private"]')!;
  await act(async () => void priv.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 3; i++) await press("Continue");
  expect(text()).toContain("Ready to create it?");
  expect(text()).toContain("from the Researcher template");
  await press("Create bot");
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    name: "Researcher",
    visibility: "private",
    avatar: templateById("researcher")!.avatar,
    instructions: templateById("researcher")!.instructions,
    computerMode: "browser",
    codeAccess: false,
  });
  await unmount();
});

test("without a working engine the preview says so instead of promising one", async () => {
  claudeStatus = "needs_login";
  const unmount = await mount();
  await pick("researcher");
  expect(text()).toContain("the offline test engine gives canned replies");
  await press("Create Researcher");
  expect(posts[0]).toMatchObject({ harness: "fixture" });
  claudeStatus = "ready";
  await unmount();
});

test("a required plugin is tagged Required in the preview and on the plugins step; suggested ones are not", async () => {
  const unmount = await mount();
  await pick("engineer");
  expect(text()).toContain("Context7");
  expect(text()).not.toContain("Required");
  await pick("reviewer");
  expect(text()).toContain("GitHub");
  expect(text()).toContain("Required");
  await press("Create Code reviewer");
  expect(text()).toContain("needs a plugin");
  expect(text()).toContain("Required");
  await unmount();
});

test("a required plugin the catalog does not list is still shown", async () => {
  catalogIds = ["context7"];
  const unmount = await mount();
  await pick("reviewer");
  expect(text()).toContain("github");
  expect(text()).toContain("Required");
  catalogIds = ["context7", "github"];
  await unmount();
});
