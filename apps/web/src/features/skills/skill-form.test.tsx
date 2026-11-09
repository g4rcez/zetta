import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./dom-env";

const win = setupDom();
afterEach(() => {
  win.document.body.innerHTML = "";
});

const asked: any[] = [];
let answer: any = { problems: [], warnings: [], bodyBytes: 2048, hermesBytes: 2100, similar: [] };
let fail = false;
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  if (path === "/api/skills/check") {
    asked.push(JSON.parse(String(init?.body)));
    return fail
      ? Response.json({ error: { code: "X", message: "boom" } }, { status: 500 })
      : Response.json({ check: answer });
  }
  return Response.json({ error: { code: "TEST", message: `unexpected ${path}` } }, { status: 500 });
}) as typeof fetch;

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";
const mount = async (props: Record<string, unknown>) => {
  const { SkillForm } = await import("./skill-form");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(<SkillForm submitLabel="Save" onSubmit={() => {}} {...props} />),
  );
  return { unmount: () => act(async () => root.unmount()) };
};

test("an empty form asks nothing", async () => {
  asked.length = 0;
  const { unmount } = await mount({});
  await wait(450);
  expect(asked).toEqual([]);
  expect(win.document.querySelector('[aria-label="Checks"]')).toBeNull();
  await unmount();
});

test("an edited skill is checked after a pause with only the fields that have text, and its own id", async () => {
  asked.length = 0;
  answer = { problems: [], warnings: [], bodyBytes: 2048, hermesBytes: 2100, similar: [] };
  const { unmount } = await mount({
    skillId: "00000000-0000-7000-8000-0000000000a1",
    initial: { name: "pdf-tools", description: "", body: "Steps" },
  });
  expect(asked).toEqual([]); // not yet: it waits for typing to stop
  await wait(450);
  expect(asked).toEqual([
    { name: "pdf-tools", body: "Steps", skillId: "00000000-0000-7000-8000-0000000000a1" },
  ]);
  expect(text()).toContain("2.0 KB of 64 KB");
  await unmount();
});

test("problems, warnings and similar skills are shown", async () => {
  asked.length = 0;
  answer = {
    problems: ["You already have a skill with this name."],
    warnings: [
      "On Hermes it takes 30 KB of the 48 KB shared by all of a bot's skills, so other skills may be left out.",
    ],
    bodyBytes: 30000,
    hermesBytes: 30100,
    similar: [
      { id: "1", name: "pdf-maker", description: "d", why: "name" },
      { id: "2", name: "pdf-writer", description: "d", why: "topic" },
    ],
  };
  const { unmount } = await mount({
    initial: { name: "pdf-tools", description: "Make PDFs from reports", body: "Steps" },
  });
  await wait(450);
  expect(text()).toContain("You already have a skill with this name.");
  expect(text()).toContain("48 KB shared by all of a bot's skills");
  expect(text()).toContain("You already have similar skills: pdf-maker, pdf-writer.");
  await unmount();
});

test("when the check cannot be made the form just goes on without notes", async () => {
  asked.length = 0;
  fail = true;
  const { unmount } = await mount({
    initial: { name: "pdf-tools", description: "d", body: "Steps" },
  });
  await wait(450);
  expect(asked).toHaveLength(1);
  expect(win.document.querySelector('[aria-label="Checks"]')).toBeNull();
  fail = false;
  await unmount();
});
