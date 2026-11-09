import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./dom-env";

const win = setupDom();
afterEach(() => {
  win.document.body.innerHTML = "";
});

const ID = "00000000-0000-7000-8000-0000000000a1";
const R3 = "00000000-0000-7000-8000-0000000000b3";
const R1 = "00000000-0000-7000-8000-0000000000b1";
const sent: { path: string; method: string; body: any }[] = [];
let conflict = false;
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method !== "GET") sent.push({ path, method, body });
  if (path === `/api/skills/${ID}/history`)
    return Response.json({
      history: {
        currentVersion: 3,
        revisions: [
          {
            id: R3,
            version: 3,
            name: "notes",
            description: "d",
            bodyBytes: 40,
            filesHash: "",
            savedBy: "Ana",
            createdAt: new Date().toISOString(),
          },
          {
            id: R1,
            version: 1,
            name: "notes",
            description: "d",
            bodyBytes: 20,
            filesHash: "",
            savedBy: "Ana",
            createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        ],
      },
    });
  if (path === `/api/skills/${ID}`)
    return Response.json({
      skill: {
        id: ID,
        name: "notes",
        description: "d",
        body: "intro\nnew step\noutro",
        version: 3,
        files: [],
      },
    });
  if (path === `/api/skills/${ID}/revisions/${R1}`)
    return Response.json({
      revision: {
        id: R1,
        version: 1,
        name: "notes",
        description: "d",
        body: "intro\nold step\noutro",
        filesHash: "",
        createdAt: "2026-11-01T00:00:00Z",
      },
    });
  if (path === `/api/skills/${ID}/revert`) {
    if (conflict)
      return Response.json(
        { error: { code: "CONFLICT", message: "This skill changed. Reload and try again." } },
        { status: 409 },
      );
    return Response.json({ skill: { id: ID, version: 4 } });
  }
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const text = () => win.document.body.textContent ?? "";
const press = async (label: string) => {
  const b = [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const mount = async () => {
  const { SkillHistory } = await import("./skill-history");
  let changed = 0;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SkillHistory skillId={ID} onChanged={() => void changed++} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { changed: () => changed, unmount: () => act(async () => root.unmount()) };
};

test("the saves are listed newest first; only the older ones can be compared", async () => {
  sent.length = 0;
  const { unmount } = await mount();
  expect(text()).toContain("Now");
  expect(text()).toContain("by Ana");
  expect(win.document.querySelectorAll("li")).toHaveLength(2);
  expect(
    [...win.document.querySelectorAll("button")].filter((b) => b.textContent === "See changes"),
  ).toHaveLength(1);
  await unmount();
});

test("choosing an older save shows what changed from it to now", async () => {
  const { unmount } = await mount();
  await press("See changes");
  const diff = win.document.querySelector('pre[aria-label="Changes"]')!;
  expect(diff.textContent).toContain("- old step");
  expect(diff.textContent).toContain("+ new step");
  expect(diff.textContent).toContain("  intro");
  expect(text()).toContain("1 line added, 1 removed.");
  await press("Hide changes");
  expect(win.document.querySelector('pre[aria-label="Changes"]')).toBeNull();
  await unmount();
});

test("putting a save back sends the version it was read at, and tells the page", async () => {
  sent.length = 0;
  conflict = false;
  const { changed, unmount } = await mount();
  await press("See changes");
  await press("Put this version back");
  expect(sent.at(-1)).toEqual({
    path: `/api/skills/${ID}/revert`,
    method: "POST",
    body: { revisionId: R1, expectedVersion: 3 },
  });
  expect(changed()).toBe(1);
  await unmount();
});

test("a skill that changed meanwhile says so and nothing is put back", async () => {
  sent.length = 0;
  conflict = true;
  const { changed, unmount } = await mount();
  await press("See changes");
  await press("Put this version back");
  expect(text()).toContain("This skill changed. Reload and try again.");
  expect(changed()).toBe(0);
  conflict = false;
  await unmount();
});
