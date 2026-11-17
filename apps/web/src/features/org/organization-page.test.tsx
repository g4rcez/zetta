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
const BOT2 = "01a19da2-3c92-783a-b90d-c35975f3c60d";
const TEAM = "01a1ce15-6b98-7fa6-a72d-0885e1cc5299";
let links: unknown[] = [];
let draft: unknown = { seats: [], skipped: [], teams: [] };
let writes: { call: string; body: unknown }[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/bots")
    return Response.json({ bots: [{ id: BOT, name: "Scribe", kind: "specialist" }] });
  if (url.pathname === "/api/org/links") return Response.json({ links });
  if (url.pathname === "/api/org/draft" && method === "GET") {
    writes.push({ call: `GET ${url.pathname}${url.search}`, body: undefined });
    return Response.json({ draft });
  }
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
  links = [];
  draft = { seats: [], skipped: [], teams: [] };
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

test("the top of the page says what the chart changes", async () => {
  const host = await organization({ view: "list" });
  expect(text(host)).toContain("Bots read their seat, and escalation follows the chart.");
});

const withSecondBot = () => [
  ...positions(),
  seat(5, S(3), "Analyst", {
    seat: "bot",
    holder: { kind: "bot", botId: BOT2, name: "Mia", description: "", avatar: null },
  }),
];

test("show=links lists who works with whom, in words, from the server's pairs", async () => {
  current = view(false, withSecondBot());
  links = [
    {
      aId: BOT,
      bId: BOT2,
      weight: 4,
      kinds: ["room", "workflow"],
      counts: { room: 3, workflow: 1, handoff: 0 },
    },
    {
      aId: BOT,
      bId: "01a19da2-3c92-783a-b90d-c35975f3c6ff",
      weight: 1,
      kinds: ["room"],
      counts: { room: 1, workflow: 0, handoff: 0 },
    },
  ];
  const host = await organization({ view: "list", show: "links" });
  const section = host.querySelector('section[aria-label="Who works with whom"]')!;
  // The second pair names a bot that holds no seat here: it is left out.
  expect(section.querySelectorAll("li")).toHaveLength(1);
  expect(section.textContent).toContain("Scribe and Mia: Work together in 3 rooms, 1 workflow");
  // The layer points nobody out: every seat is lit the same.
  const rows = [...host.querySelectorAll("ul[aria-label='Organization outline'] li > div")];
  expect(rows.filter((r) => r.className.includes("opacity-50"))).toHaveLength(0);
});

test("without the layer in the address the page does not ask for the pairs", async () => {
  current = view(false, withSecondBot());
  links = [
    {
      aId: BOT,
      bId: BOT2,
      weight: 1,
      kinds: ["room"],
      counts: { room: 1, workflow: 0, handoff: 0 },
    },
  ];
  const host = await organization({ view: "list" });
  expect(host.querySelector('section[aria-label="Who works with whom"]')).toBeNull();
});

test("the works-with choice writes show=links to the address", async () => {
  const seen: object[] = [];
  const host = await mount(async () => {
    const { OrganizationPage } = await import("./organization-page");
    return <OrganizationPage search={{ view: "list" }} onSearch={(next) => void seen.push(next)} />;
  });
  const group = host.querySelector('[role="group"][aria-label="What to show"]')!;
  const pick = [...group.querySelectorAll("button")].find((b) => b.textContent === "Works with")!;
  expect(pick.getAttribute("aria-pressed")).toBe("false");
  await click(pick);
  expect(seen).toEqual([{ view: "list", show: "links" }]);
});

test("a bot's settings say who it reports to and link to its seat on the chart", async () => {
  current = view(false, withSecondBot());
  const host = await mount(async () => {
    const { BotOrgSection } = await import("./bot-org-section");
    return <BotOrgSection botId={BOT2} />;
  });
  expect(text(host)).toContain("Reports to an open seat (CFO)");
  const link = [...host.querySelectorAll("a")].find((a) => a.textContent === "See on the chart")!;
  expect(link.getAttribute("href")).toBe(`/organization?focus=${S(5)}`);
});

const teamDraft = () => ({
  seats: [
    {
      ref: 0,
      parentRef: null,
      rank: "ceo",
      title: "CEO",
      description: "",
      unit: "Company",
      team: null,
      holder: null,
      note: null,
    },
    {
      ref: 1,
      parentRef: 0,
      rank: "lead",
      title: "Alpha lead",
      description: "",
      unit: "Alpha",
      team: { id: TEAM, name: "Alpha" },
      holder: { botId: BOT, name: "Scribe" },
      note: null,
    },
    {
      ref: 2,
      parentRef: 1,
      rank: "member",
      title: "Writer",
      description: "",
      unit: "Alpha",
      team: null,
      holder: { botId: BOT2, name: "Mia" },
      note: null,
    },
  ],
  skipped: [{ botId: "x", name: "Hidden", teamName: "Alpha", reason: "private" }],
  teams: [{ id: TEAM, name: "Alpha", botCount: 3 }],
});

test("Draw it from my teams opens a preview and saves nothing until it is confirmed", async () => {
  current = { ...view(true, []), chart: { id: null, name: "Company", version: 0 } };
  draft = teamDraft();
  const host = await organization();
  await click(buttons(host, "Review the draft")[0]);
  const t = text(host);
  for (const word of [
    "Your teams as a chart",
    "Alpha lead",
    "Scribe",
    "Writer",
    "Mia",
    "Hidden (Alpha): it is private",
  ])
    expect(t).toContain(word);
  expect(buttons(host, "Create 3 seats")).toHaveLength(1);
  // Only reads so far.
  expect(writes.every((w) => w.call.startsWith("GET"))).toBe(true);
  // Leave Mia out, then confirm: the write names what was left out.
  const mia = [...host.querySelectorAll('input[type="checkbox"]')].find((c) =>
    c.closest("div")?.textContent?.includes("Writer"),
  ) as unknown as HTMLInputElement;
  await click(mia);
  expect(buttons(host, "Create 2 seats")).toHaveLength(1);
  await click(buttons(host, "Create 2 seats")[0]);
  expect(writes.at(-1)).toEqual({
    call: "POST /api/org/draft",
    body: { expectedVersion: 0, skipTeamIds: [], skipBotIds: [BOT2] },
  });
});

test("leaving a team out of the draft drops its bots, and Back returns to the structures", async () => {
  current = { ...view(true, []), chart: { id: null, name: "Company", version: 0 } };
  draft = teamDraft();
  const host = await organization();
  await click(buttons(host, "Review the draft")[0]);
  const lead = [
    ...host.querySelectorAll('input[type="checkbox"]'),
  ][0] as unknown as HTMLInputElement;
  await click(lead);
  expect(buttons(host, "Create 1 seat")).toHaveLength(1);
  await click(buttons(host, "Create 1 seat")[0]);
  expect(writes.at(-1)!.body).toEqual({ expectedVersion: 0, skipTeamIds: [TEAM], skipBotIds: [] });
  await click(buttons(host, "Back")[0]);
  expect(text(host)).toContain("Draw your organization");
});

test("with no teams the preview says so and offers nothing to create", async () => {
  current = { ...view(true, []), chart: { id: null, name: "Company", version: 0 } };
  const host = await organization();
  await click(buttons(host, "Review the draft")[0]);
  expect(text(host)).toContain("You have no teams yet.");
  expect((buttons(host, "Create these seats")[0] as unknown as HTMLButtonElement).disabled).toBe(
    true,
  );
});
