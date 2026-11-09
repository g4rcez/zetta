import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./dom-env";

const win = setupDom();
afterEach(() => {
  win.document.body.innerHTML = "";
});

const BOT = "00000000-0000-7000-8000-000000000001";
const A = "00000000-0000-7000-8000-0000000000a1";
const B = "00000000-0000-7000-8000-0000000000a2";
const C = "00000000-0000-7000-8000-0000000000a3";
const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const base = {
  ownerUserId: "me",
  ownerName: "Me",
  source: "manual",
  sourceRepo: null,
  sourcePath: null,
  sourceRef: null,
  version: 1,
  status: "active",
  filesStatus: "complete",
  createdAt: "2026-11-02T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
  botIds: [] as string[],
};
const active = [
  {
    ...base,
    id: A,
    name: "release-notes",
    description: "Write release notes",
    bodyBytes: 2048,
    lastUsedAt: ago(2),
    uses30d: 3,
    botIds: [BOT],
  },
  {
    ...base,
    id: B,
    name: "pdf-tools",
    source: "github",
    sourceRepo: "acme/tools",
    description: "Make PDFs",
    bodyBytes: 900,
    lastUsedAt: ago(40),
    uses30d: 0,
  },
  {
    ...base,
    id: C,
    name: "fresh-one",
    description: "Brand new",
    bodyBytes: 120,
    lastUsedAt: null,
    uses30d: 0,
  },
];
const removed = [
  {
    ...base,
    id: A,
    name: "old-skill",
    description: "Was removed",
    status: "archived",
    bodyBytes: 300,
    lastUsedAt: null,
    uses30d: 0,
  },
];

const listPaths: string[] = [];
const sent: { path: string; method: string; body: any }[] = [];
let bulkAnswer: any = { changed: 2, skippedBots: [] };
let updatesAnswer: any[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method !== "GET") sent.push({ path, method, body });
  if (path === "/api/bots")
    return Response.json({
      bots: [{ id: BOT, name: "Da Vinci", kind: "specialist", avatar: null, canEdit: true }],
    });
  if (path.startsWith("/api/skills?")) {
    listPaths.push(path);
    return Response.json({
      skills: url.searchParams.get("status") === "archived" ? removed : active,
    });
  }
  if (path === "/api/skills/bulk") return Response.json(bulkAnswer);
  if (path === "/api/skills/updates") return Response.json({ updates: updatesAnswer });
  if (path === `/api/skills/${B}/update`) return Response.json({ skill: { id: B } });
  if (path.endsWith("/restore"))
    return Response.json({ skill: { ...removed[0], status: "active" } });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const text = () => win.document.body.textContent ?? "";
const buttons = () => [...win.document.querySelectorAll("button")];
const press = async (label: string, nth = 0) => {
  const b = buttons().filter((x) => x.textContent?.trim() === label)[nth];
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const tick = async (label: string) => {
  const el = win.document.querySelector(
    `input[aria-label="${label}"]`,
  ) as unknown as HTMLInputElement | null;
  if (!el) throw new Error(`no checkbox "${label}"`);
  await act(
    async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};

type Search = import("./skills-search").SkillsSearch;
const mount = async (initial: Search) => {
  const { SkillsPage } = await import("./skills-page");
  const { withSearch } = await import("./skills-search");
  const { useState } = await import("react");
  const changes: { search: Search; replace: boolean }[] = [];
  function Address() {
    const [search, setAddress] = useState<Search>(initial);
    return (
      <SkillsPage
        userId="me"
        isAdmin={false}
        search={search}
        setSearch={(patch, options) => {
          const next = withSearch(search, patch);
          changes.push({ search: next, replace: options?.replace ?? false });
          setAddress(next);
        }}
      />
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
        <Address />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { changes, unmount: () => act(async () => root.unmount()) };
};
const reset = () => {
  listPaths.length = 0;
  sent.length = 0;
  bulkAnswer = { changed: 2, skippedBots: [] };
  updatesAnswer = [];
};

test("every filter comes from the address: the list is asked for with no click", async () => {
  reset();
  const { unmount } = await mount({
    find: "note",
    source: "github",
    sort: "used",
    bot: BOT,
    use: "unused",
  });
  expect(listPaths.at(-1)).toBe(
    `/api/skills?scope=mine&q=note&source=github&sort=used&bot=${BOT}&unused=yes`,
  );
  const search = win.document.querySelector('[role="search"][aria-label="Filter skills"]')!;
  expect((search.querySelector("input") as unknown as HTMLInputElement).value).toBe("note");
  expect(
    buttons()
      .find((b) => b.textContent === "Unused")
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await unmount();
});

test("each skill says how big it is and how it was used", async () => {
  reset();
  const { unmount } = await mount({});
  expect(listPaths.at(-1)).toBe("/api/skills?scope=mine");
  expect(text()).toContain("2.0 KB · Used 3 times in 30 days, last 2d ago");
  expect(text()).toContain("900 B · Not used in 30 days, last 1mo ago");
  expect(text()).toContain("120 B · Never used");
  await unmount();
});

test("choosing Unused or Removed goes into the address, as a new history entry", async () => {
  reset();
  const { changes, unmount } = await mount({});
  await press("Unused");
  expect(changes.at(-1)).toEqual({ search: { use: "unused" }, replace: false });
  await press("Removed");
  expect(changes.at(-1)).toEqual({ search: { use: "unused", view: "archived" }, replace: false });
  await press("Unused");
  expect(changes.at(-1)!.search).toEqual({ view: "archived" });
  await unmount();
});

test("the removed skills are listed on their own and can be restored, not edited", async () => {
  reset();
  const { unmount } = await mount({ view: "archived" });
  expect(listPaths.at(-1)).toBe("/api/skills?scope=mine&status=archived");
  expect(text()).toContain("Removed skills");
  expect(text()).toContain("old-skill");
  expect(buttons().some((b) => b.textContent === "Edit")).toBe(false);
  expect(buttons().some((b) => b.textContent === "Remove")).toBe(false);
  expect(win.document.querySelector('input[aria-label="Select old-skill"]')).toBeNull();
  await press("Restore");
  expect(sent.at(-1)).toMatchObject({ path: `/api/skills/${A}/restore`, method: "POST" });
  expect(text()).toContain("Restored.");
  await unmount();
});

test("several skills can be given to bots at once; nothing is sent until a bot is chosen", async () => {
  reset();
  const { unmount } = await mount({});
  await tick("Select release-notes");
  await tick("Select pdf-tools");
  expect(text()).toContain("2 selected");
  await press("Give to bots");
  expect(buttons().find((b) => b.textContent === "Apply")?.disabled).toBe(true);
  await tick("Da Vinci");
  await press("Apply");
  expect(sent.at(-1)).toEqual({
    path: "/api/skills/bulk",
    method: "POST",
    body: { action: "attach", skillIds: [A, B], botIds: [BOT] },
  });
  expect(text()).toContain("Done. The bots load them at their next run.");
  await unmount();
});

test("a bot left out because it is full is named", async () => {
  reset();
  bulkAnswer = { changed: 0, skippedBots: [BOT] };
  const { unmount } = await mount({});
  await tick("Select fresh-one");
  await press("Give to bots");
  await tick("Da Vinci");
  await press("Apply");
  expect(text()).toContain(
    "Da Vinci already has the most skills a bot can bring, so it was left out.",
  );
  await unmount();
});

test("selected skills can be removed together, after a question", async () => {
  reset();
  const { unmount } = await mount({});
  await tick("Select all");
  expect(text()).toContain("3 selected");
  await press("Remove");
  expect(sent).toEqual([]);
  await press("Yes, remove");
  expect(sent.at(-1)).toEqual({
    path: "/api/skills/bulk",
    method: "POST",
    body: { action: "archive", skillIds: [A, B, C] },
  });
  await unmount();
});

const LATEST = "2".repeat(40);
const update = (over = {}) => ({
  id: B,
  name: "pdf-tools",
  repo: "acme/tools",
  installedRef: "1".repeat(40),
  latestRef: LATEST,
  state: "update",
  edited: false,
  ...over,
});

test("checking GitHub is on request, and a skill with a newer version can be updated in one click", async () => {
  reset();
  updatesAnswer = [update()];
  const { unmount } = await mount({});
  expect(text()).not.toContain("Newer version on GitHub");
  await press("Check GitHub for updates");
  expect(text()).toContain("1 with a newer version.");
  expect(text()).toContain("Newer version on GitHub");
  await press("Update");
  expect(sent.at(-1)).toEqual({
    path: `/api/skills/${B}/update`,
    method: "POST",
    body: { ref: LATEST },
  });
  expect(text()).toContain("Updated. Every bot that uses it loads the new text at its next run.");
  await unmount();
});

test("a skill the owner edited asks first, then sends the consent", async () => {
  reset();
  updatesAnswer = [update({ edited: true })];
  const { unmount } = await mount({});
  await press("Check GitHub for updates");
  await press("Update");
  expect(sent).toEqual([]);
  expect(text()).toContain("Updating replaces your changes (they stay in its history).");
  await press("Yes, update");
  expect(sent.at(-1)).toEqual({
    path: `/api/skills/${B}/update`,
    method: "POST",
    body: { ref: LATEST, overwriteEdited: "yes" },
  });
  await unmount();
});

test("a skill gone from GitHub and an unreachable GitHub are said plainly; a current skill shows nothing", async () => {
  reset();
  updatesAnswer = [
    update({ state: "gone" }),
    update({ id: A, name: "release-notes", state: "unknown" }),
    update({ id: C, name: "fresh-one", state: "current" }),
  ];
  const { unmount } = await mount({});
  await press("Check GitHub for updates");
  expect(text()).toContain("It is no longer on GitHub.");
  expect(text()).toContain("GitHub did not answer for some of them.");
  expect(text()).not.toContain("Newer version on GitHub");
  await unmount();
});

test("the removed view has no update button", async () => {
  reset();
  const { unmount } = await mount({ view: "archived" });
  expect(buttons().some((b) => b.textContent === "Check GitHub for updates")).toBe(false);
  await unmount();
});
