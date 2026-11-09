import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { buildAnswer, type PausedCallPatch } from "./tool-card";

const win = setupDom();

const ASKER = { id: "01a19da2-3c92-783a-b90d-c35975f3c60c", name: "Treinador", kind: "specialist" };
const approval = (over: Partial<PausedCallPatch["pause"]> = {}): PausedCallPatch => ({
  plugin: "apps",
  pause: {
    requestId: "apr_1",
    mode: "approval",
    tool: "issues.close",
    message: "Approve issues.close?",
    input: '{"number":7}',
    expiresAt: Date.now() + 10 * 60_000,
    ...over,
  },
});
const form = (): PausedCallPatch =>
  approval({
    mode: "input",
    requestId: "elc_1",
    tool: "issues.rename",
    message: "New title?",
    input: undefined,
    fields: [
      { key: "title", label: "Title", type: "string", required: true },
      { key: "points", label: "Points", type: "number", required: false },
      { key: "urgent", label: "Urgent", type: "boolean", required: false },
    ],
  });

const render = async (patch: PausedCallPatch, onDecide: (a: boolean, answer?: object) => void) => {
  const { ToolPauseCard } = await import("./tool-card");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ToolPauseCard
          asker={ASKER as never}
          patch={patch}
          expiresAt={new Date(Date.now() + 10 * 60_000).toISOString()}
          busy={false}
          onDecide={onDecide as never}
        />
      </QueryClientProvider>,
    ),
  );
  const buttons = () => [...(host as unknown as HTMLElement).querySelectorAll("button")];
  const press = async (label: string) => {
    const b = buttons().find((x) => x.textContent === label)!;
    await act(async () => b.click());
  };
  return {
    host: host as unknown as HTMLElement,
    press,
    buttons,
    unmount: () => act(async () => root.unmount()),
  };
};

test("an approval shows the bot, the tool and the exact input, and nothing is sent until a button is pressed", async () => {
  const calls: unknown[][] = [];
  const { host, buttons, unmount } = await render(approval(), (...a) => calls.push(a));
  expect(host.textContent).toContain("Treinador");
  expect(host.textContent).toContain("asks to run");
  expect(host.textContent).toContain("issues.close");
  expect(host.textContent).toContain('{"number":7}');
  expect(host.textContent).toContain("Expires");
  expect(buttons().map((b) => b.textContent)).toEqual(["Decline", "Approve"]);
  expect(calls).toEqual([]);
  await unmount();
});

test("Approve sends a yes with no answer; Decline sends a no", async () => {
  const calls: unknown[][] = [];
  const { press, unmount } = await render(approval(), (...a) => calls.push(a));
  await press("Approve");
  await press("Decline");
  expect(calls).toEqual([[true], [false]]);
  await unmount();
});

test("text from the service is shown as text, never as markup", async () => {
  const { host, unmount } = await render(
    approval({ message: '<img src=x onerror="alert(1)"> Approve?', input: "<b>bold</b>" }),
    () => {},
  );
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("pre b")).toBeNull();
  expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
  await unmount();
});

test("a form asks for its fields, refuses a missing required one, and sends typed values", async () => {
  const calls: unknown[][] = [];
  const { host, press, unmount } = await render(form(), (...a) => calls.push(a));
  expect(host.textContent).toContain("needs an answer for");
  expect(host.textContent).toContain("Title");
  expect(host.textContent).toContain("Points (optional)");
  await press("Send answer");
  expect(calls).toEqual([]);
  // The input library renders its own (empty) alert slots, so look at all of them.
  const alerts = [...host.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");
  expect(alerts).toContain("Title needs a value");
  await unmount();
});

test("buildAnswer types numbers, keeps booleans and leaves blank optional fields out", () => {
  const fields = form().pause.fields!;
  expect(buildAnswer(fields, { title: " Better ", points: "3" })).toEqual({
    answer: { title: "Better", points: 3, urgent: false },
  });
  expect(buildAnswer(fields, { title: "x", urgent: true })).toEqual({
    answer: { title: "x", urgent: true },
  });
  expect(buildAnswer(fields, { title: "x", points: "many" })).toEqual({ missing: "Points" });
  expect(buildAnswer(fields, { title: "   " })).toEqual({ missing: "Title" });
});
