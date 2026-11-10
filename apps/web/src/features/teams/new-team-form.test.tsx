import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Bun's own FormData cannot read a DOM form; the page uses the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
const realFetch = globalThis.fetch;
let finished = false;
afterAll(() => {
  globalThis.FormData = bunFormData;
  finished = true;
});
const TEAM = "00000000-0000-7000-8000-0000000000f1";
const A = "00000000-0000-7000-8000-0000000000b1";
const B = "00000000-0000-7000-8000-0000000000b2";
const sent: { method: string; path: string; body: any }[] = [];
const fake = (async (input: URL | Request | string, init?: RequestInit) => {
  if (finished) return (globalThis.fetch === fake ? realFetch : globalThis.fetch)(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  sent.push({ method, path: url.pathname, body });
  const team = {
    id: TEAM,
    name: body?.name ?? "x",
    goal: "",
    context: "",
    canvas: body?.canvas,
    version: method === "POST" ? 1 : 2,
    members: [],
  };
  return Response.json({ team }, { status: method === "POST" ? 201 : 200 });
}) as typeof fetch;
globalThis.fetch = fake;

const { NewTeamForm, nextBox, memberPoints } = await import("./new-team-form");

async function mount(onCreated: (t: { id: string }) => void) {
  win.document.body.replaceChildren();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  await act(async () =>
    root.render(
      <NewTeamForm
        bots={[
          { id: A, name: "Writer" },
          { id: B, name: "Editor" },
        ]}
        existing={1}
        onCreated={onCreated}
        onCancel={() => {}}
      />,
    ),
  );
  return root;
}
const setValue = (sel: string, v: string) =>
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
    win.document.querySelector(sel),
    v,
  );
const check = (sel: string) =>
  ((win.document.querySelector(sel) as unknown as HTMLInputElement).checked = true);
const submit = () =>
  act(async () => {
    win.document
      .querySelector("form")!
      .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never);
    await new Promise((r) => setTimeout(r, 30));
  });

test("one step: the team is created with its bots and the picked lead", async () => {
  sent.length = 0;
  const created: string[] = [];
  const root = await mount((t) => created.push(t.id));
  setValue('[name="name"]', "Launch team");
  check(`input[name="bots"][value="${A}"]`);
  check(`input[name="bots"][value="${B}"]`);
  check(`input[name="lead"][value="${B}"]`);
  await submit();
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
    "POST /api/teams",
    `PUT /api/teams/${TEAM}`,
  ]);
  expect(sent[0]!.body.name).toBe("Launch team");
  expect(sent[1]!.body.expectedVersion).toBe(1);
  expect(
    sent[1]!.body.members.map((m: { botId: string; kind: string }) => [m.botId, m.kind]),
  ).toEqual([
    [A, "member"],
    [B, "chief"],
  ]);
  expect(created).toEqual([TEAM]);
  await act(async () => root.unmount());
});

test("a lead that is not in the team is refused before anything is sent", async () => {
  sent.length = 0;
  const root = await mount(() => {});
  setValue('[name="name"]', "Odd team");
  check(`input[name="bots"][value="${A}"]`);
  check(`input[name="lead"][value="${B}"]`);
  await submit();
  expect(sent).toEqual([]);
  expect(win.document.body.textContent).toContain("The lead must be one of the bots in the team.");
  await act(async () => root.unmount());
});

test("members sit inside the box, and the box grows to fit them", () => {
  const box = nextBox(0, 6);
  const pts = memberPoints(box, 6);
  expect(pts.every((p) => p.x >= box.x && p.y >= box.y && p.y < box.y + box.h)).toBe(true);
  expect(nextBox(0, 0).h).toBeLessThan(box.h + 1);
});
