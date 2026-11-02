import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./dom-env";

const win = setupDom();

const BOT = "00000000-0000-7000-8000-000000000001";
const SKILL = "00000000-0000-7000-8000-0000000000a1";
const SHA = "1234567890abcdef1234567890abcdef12345678";
const posts: { path: string; body: unknown }[] = [];
const api = (path: string, method: string, body: unknown) => {
  if (method === "POST") posts.push({ path, body });
  if (path === "/api/bots")
    return {
      bots: [{ id: BOT, name: "Da Vinci", kind: "specialist", avatar: null, canEdit: true }],
    };
  if (path === "/api/skills?scope=mine")
    return {
      skills: [
        {
          id: SKILL,
          ownerUserId: "me",
          ownerName: "Me",
          name: "release-notes",
          description: "Write release notes",
          source: "manual",
          sourceRepo: null,
          sourcePath: null,
          sourceRef: null,
          version: 1,
          createdAt: "2026-11-02T00:00:00Z",
          updatedAt: "2026-11-02T00:00:00Z",
          botIds: [BOT],
        },
      ],
    };
  if (path === "/api/skills?scope=all")
    return {
      skills: [
        {
          id: SKILL,
          ownerUserId: "someone-else",
          ownerName: "Ana",
          name: "their-skill",
          description: "Another person's skill",
          source: "manual",
          sourceRepo: null,
          sourcePath: null,
          sourceRef: null,
          version: 1,
          createdAt: "2026-11-02T00:00:00Z",
          updatedAt: "2026-11-02T00:00:00Z",
          botIds: [],
        },
      ],
    };
  if (path === "/api/skills/market/suggestions")
    return { suggestions: [{ repo: "acme/skills", blurb: "Acme's skills.", trust: "trusted" }] };
  if (path === "/api/skills/market/repo?source=acme%2Fskills")
    return {
      repo: "acme/skills",
      ref: SHA,
      truncated: false,
      trust: "trusted",
      skills: [
        {
          name: "pdf",
          path: "skills/pdf/SKILL.md",
          description: "Make PDFs",
          warnings: [],
          installedId: null,
        },
        {
          name: "interview-me",
          path: "skills/interview-me/SKILL.md",
          description: "Interview the user",
          warnings: [],
          installedId: null,
        },
        {
          name: "old",
          path: "skills/old/SKILL.md",
          description: "Already here",
          warnings: [],
          installedId: SKILL,
        },
        {
          name: "unsafe",
          path: "skills/unsafe/SKILL.md",
          description: "Bad",
          warnings: ["shell_injection"],
          installedId: null,
        },
      ],
    };
  if (path === "/api/skills/market/install")
    return (body as { paths: string[] }).paths.includes("skills/old/SKILL.md")
      ? {
          installed: [],
          attached: [{ id: SKILL, name: "old", botIds: [BOT] }],
          failed: [],
          attachError: null,
        }
      : {
          installed: [{ id: SKILL, name: "pdf", botIds: [BOT] }],
          attached: [],
          failed: [],
          attachError: null,
        };
  throw new Error(`unexpected ${method} ${path}`);
};
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  try {
    return Response.json(
      api(path, init?.method ?? "GET", init?.body ? JSON.parse(String(init.body)) : undefined),
    );
  } catch (e) {
    return Response.json(
      { error: { code: "TEST", message: (e as Error).message } },
      { status: 500 },
    );
  }
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const buttons = () => [...win.document.querySelectorAll("button")];
const press = async (label: string, nth = 0) => {
  const b = buttons().filter((x) => x.textContent?.trim() === label)[nth];
  if (!b) throw new Error(`no button "${label}" #${nth} in: ${win.document.body.textContent}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const click = async (el: HTMLInputElement) => {
  await act(
    async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};
const text = () => win.document.body.textContent ?? "";

type Search = import("./skills-search").SkillsSearch;
/** The page in a stand-in for the router: the address is the state, and every change to it is recorded. */
const mount = async (initial: Search, isAdmin = false) => {
  const { SkillsPage } = await import("./skills-page");
  const { withSearch } = await import("./skills-search");
  const { useState } = await import("react");
  const changes: { search: Search; replace: boolean }[] = [];
  function Address() {
    const [search, setAddress] = useState<Search>(initial);
    return (
      <SkillsPage
        userId="me"
        isAdmin={isAdmin}
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
  await act(async () => root.render(<Address />));
  await settle();
  return { changes, unmount: () => act(async () => root.unmount()) };
};

test("the page lists my skills with the bots that use them, and the marketplace installs only the skills that were chosen", async () => {
  const { changes, unmount } = await mount({});

  expect(text()).toContain("release-notes");
  expect(text()).toContain("Write release notes");
  expect(text()).toContain("Da Vinci");
  expect(text()).not.toContain("Show every person's skills");

  // Choosing the tab and a repository goes into the address.
  await press("Marketplace");
  expect(changes.at(-1)).toEqual({ search: { tab: "market" }, replace: false });
  expect(text()).toContain("acme/skills");
  expect(text()).toContain("Trusted");
  await press("acme/skillsTrustedAcme's skills.");
  expect(changes.at(-1)).toEqual({ search: { tab: "market", q: "acme/skills" }, replace: false });
  expect(text()).toContain("4 skills");

  // Only the unsafe skill cannot be chosen: an installed one can, to bring it to more bots. The rest are chosen one by one or all at once.
  const box = (name: string) =>
    win.document.querySelector(`input[aria-label="${name}"]`) as unknown as HTMLInputElement;
  expect(box("unsafe").disabled).toBe(true);
  expect(text()).toContain("It runs shell commands when it loads");
  expect(box("old").disabled).toBe(false);
  expect(buttons().find((b) => b.textContent?.trim() === "Install")?.disabled).toBe(true);

  await click(box("pdf"));
  await settle();
  expect(buttons().some((b) => b.textContent?.trim() === "Install 1 skill")).toBe(true);
  await press("Select all");
  expect(buttons().some((b) => b.textContent?.trim() === "Install 3 skills")).toBe(true);
  await press("Clear");
  await click(box("interview-me"));
  await settle();

  await press("Install 1 skill");
  expect(posts.at(-1)).toEqual({
    path: "/api/skills/market/install",
    body: { source: "acme/skills", sha: SHA, paths: ["skills/interview-me/SKILL.md"], botIds: [] },
  });
  expect(text()).toContain("Installed 1 skill.");

  // A skill that is already installed can be chosen to bring it to a bot: a bot has to be picked first, and nothing is installed again.
  await click(box("old"));
  expect(
    buttons().find((b) => b.textContent?.trim() === "Add 1 skill to these bots")?.disabled,
  ).toBe(true);
  await click(box("Da Vinci"));
  await press("Add 1 skill to these bots");
  expect(posts.at(-1)).toEqual({
    path: "/api/skills/market/install",
    body: { source: "acme/skills", sha: SHA, paths: ["skills/old/SKILL.md"], botIds: [BOT] },
  });
  expect(text()).toContain("Brought 1 skill that you already had to the chosen bots.");
  expect(text()).not.toContain("Installed 1 skill. Brought");
  await unmount();
});

test("a page opened from its address shows the same view: the tab, the results and the filter come from the URL", async () => {
  const { unmount } = await mount({ tab: "market", q: "acme/skills", filter: "pdf" });
  // No click: the results are read from `q`, and only the skills matching `filter` are listed.
  expect(text()).toContain("4 skills");
  expect(text()).toContain("Make PDFs");
  expect(text()).toContain("pdf");
  expect(text()).not.toContain("interview-me");
  await unmount();
});

test("an admin opened with scope=all sees everyone's skills", async () => {
  const { unmount } = await mount({ scope: "all" }, true);
  expect(text()).toContain("Everyone's skills");
  expect(text()).toContain("their-skill");
  expect(text()).toContain("Ana");
  await unmount();
});
