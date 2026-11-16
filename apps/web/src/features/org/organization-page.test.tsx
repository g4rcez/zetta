import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });

const S = (n: number) => `01a1ce15-6b98-7fa6-a72d-0885e1cc52${String(n).padStart(2, "0")}`;
const BOT = "01a19da2-3c92-783a-b90d-c35975f3c60c";
const seat = (n: number, parentId: string | null, title: string, over: object = {}) => ({
  id: S(n),
  parentId,
  rank: parentId === null ? "ceo" : "member",
  title,
  description: "",
  unit: "",
  sortOrder: n,
  templateKey: null,
  seat: "open",
  holder: null,
  problem: null,
  team: null,
  ...over,
});
// CEO (Ana) ─ CTO (bot Scribe) ─ Engineer
//          └─ CFO (open, was Rui)
const positions = () => [
  seat(1, null, "CEO", {
    seat: "person",
    holder: { kind: "person", userId: "u1", name: "Ana Souza", avatar: null },
  }),
  seat(2, S(1), "CTO", {
    rank: "executive",
    unit: "Engineering",
    templateKey: "cto",
    description: "Owns the technology.",
    seat: "bot",
    holder: { kind: "bot", botId: BOT, name: "Scribe", description: "Writes", avatar: null },
  }),
  seat(3, S(1), "CFO", {
    rank: "executive",
    problem: { code: "member_removed", was: "Rui Lima", mine: false },
  }),
  seat(4, S(2), "Developer"),
];
const palette = {
  people: [{ userId: "u1", name: "Ana Souza", avatar: null }],
  bots: [{ id: BOT, name: "Scribe", description: "Writes", avatar: null }],
  teams: [],
};
const view = (canEdit: boolean, list = positions()) => ({
  chart: { id: "c1", name: "Company", version: 4 },
  positions: list,
  canEdit,
  palette: canEdit ? palette : null,
});

let current: unknown = view(false);
let writes: { call: string; body: unknown }[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/bots")
    return Response.json({ bots: [{ id: BOT, name: "Scribe", kind: "specialist" }] });
  if (url.pathname.startsWith("/api/org")) {
    if (method !== "GET")
      writes.push({
        call: `${method} ${url.pathname}${url.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
    return Response.json({ org: current });
  }
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  current = view(false);
  writes = [];
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const mount = async (page: () => Promise<ReactNode>) => {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const node = await page();
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {node}
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
  mounted.push(() => act(async () => root.unmount()));
  return host as unknown as HTMLElement;
};
const organization = (search: object = {}) =>
  mount(async () => {
    const { OrganizationPage } = await import("./organization-page");
    return <OrganizationPage search={search} onSearch={() => {}} />;
  });
const seatPage = (id: string) =>
  mount(async () => {
    const { PositionPage } = await import("./position-page");
    return <PositionPage id={id} />;
  });
const text = (host: HTMLElement) => host.textContent ?? "";
const buttons = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent?.includes(label));
const named = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label")?.includes(label));
const click = async (el: Element | undefined) => {
  await act(
    async () => void el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};

test("someone who is not the admin is told the chart is not drawn yet", async () => {
  current = view(false, []);
  const host = await organization();
  expect(text(host)).toContain("The admin has not drawn the company chart yet.");
  expect(buttons(host, "Use this structure")).toHaveLength(0);
});

test("the admin starts from a structure, and the write names the version zero of an empty chart", async () => {
  current = { ...view(true, []), chart: { id: null, name: "Company", version: 0 } };
  const host = await organization();
  for (const title of [
    "Solo founder with bots",
    "Small startup",
    "Agency or services firm",
    "Software product team",
    "Customer support desk",
  ])
    expect(text(host)).toContain(title);
  expect(buttons(host, "Start with just a CEO")).toHaveLength(1);
  await click(buttons(host, "Use this structure")[1]);
  expect(writes).toEqual([
    { call: "POST /api/org/presets", body: { expectedVersion: 0, presetKey: "small-startup" } },
  ]);
});

test("a reader sees the outline: seats under their managers, faces, open seats and why", async () => {
  const host = await organization({ view: "list" });
  const t = text(host);
  for (const word of ["CEO", "CTO", "CFO", "Developer", "Ana Souza", "Scribe", "Engineering"])
    expect(t).toContain(word);
  expect(t).toContain("Open seat (was Rui Lima)");
  expect(t).toContain("Only the admin changes the chart.");
  // Nothing to change for a reader: no menus, no palette.
  expect(named(host, "Actions for")).toHaveLength(0);
  expect(host.querySelector('[aria-label="People, bots and roles"]')).toBeNull();
  // The engineer is nested under the CTO, who is nested under the CEO.
  const tree = host.querySelector('ul[aria-label="Organization outline"]')!;
  expect(tree.querySelectorAll("ul")).toHaveLength(2);
});

test("the admin has a menu on every seat", async () => {
  current = view(true);
  const host = await organization({ view: "list" });
  expect(named(host, "Actions for")).toHaveLength(4);
  expect(named(host, "Actions for CTO")).toHaveLength(1);
  expect(text(host)).not.toContain("Only the admin changes the chart.");
});

test("a search from the address points out the seats that match and dims the rest", async () => {
  const host = await organization({ view: "list", q: "scribe" });
  const rows = [...host.querySelectorAll("ul[aria-label='Organization outline'] li > div")];
  const lit = rows.filter((r) => r.className.includes("ring-primary"));
  const dim = rows.filter((r) => r.className.includes("opacity-50"));
  expect(lit).toHaveLength(1);
  expect(lit[0]!.textContent).toContain("CTO");
  expect(dim).toHaveLength(3);
});

test("the people filter keeps only the seats held by people", async () => {
  const host = await organization({ view: "list", show: "people" });
  const rows = [...host.querySelectorAll("ul[aria-label='Organization outline'] li > div")];
  expect(rows.filter((r) => r.className.includes("ring-primary"))).toHaveLength(1);
});

test("a branch folds away and comes back", async () => {
  const host = await organization({ view: "list" });
  expect(text(host)).toContain("Developer");
  await click(named(host, "Hide what is under CTO")[0]);
  expect(host.querySelector('ul[aria-label="Organization outline"]')!.textContent).not.toContain(
    "Developer",
  );
  await click(named(host, "Show what is under CTO")[0]);
  expect(text(host)).toContain("Developer");
});

test("a seat's page reads for a reader: the line above it, its words, who holds it, no form", async () => {
  const host = await seatPage(S(2));
  const t = text(host);
  expect(host.querySelector('nav[aria-label="Reporting line"]')).not.toBeNull();
  expect(t).toContain("Owns the technology.");
  expect(t).toContain("Scribe");
  expect(t).toContain("How this kind of seat works");
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(buttons(host, "Remove this seat")).toHaveLength(0);
  // The developer reports to it.
  expect(t).toContain("Developer");
});

test("an open seat explains why, on its page", async () => {
  const host = await seatPage(S(3));
  expect(text(host)).toContain("Rui Lima is no longer a member, so this seat is open.");
});

test("the admin changes who holds a seat; the write carries the version they saw", async () => {
  current = view(true);
  const host = await seatPage(S(3));
  const radios = [
    ...host.querySelectorAll('input[name="holder"]'),
  ] as unknown as HTMLInputElement[];
  // Nobody, one person, one bot.
  expect(radios).toHaveLength(3);
  await click(radios[1]);
  await click(buttons(host, "Save who holds it")[0]);
  expect(writes).toEqual([
    {
      call: `PUT /api/org/positions/${S(3)}/seat`,
      body: { expectedVersion: 4, holder: { kind: "person", userId: "u1" } },
    },
  ]);
});

test("the admin removes a seat after being asked", async () => {
  current = view(true);
  const host = await seatPage(S(4));
  await click(buttons(host, "Remove this seat")[0]);
  expect(writes).toEqual([]);
  expect(text(host)).toContain("Remove Developer?");
  await click(buttons(host, "Remove").find((b) => b.textContent === "Remove"));
  expect(writes).toEqual([
    { call: `DELETE /api/org/positions/${S(4)}?expectedVersion=4`, body: undefined },
  ]);
});
