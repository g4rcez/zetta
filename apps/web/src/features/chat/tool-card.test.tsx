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

test("a mail shows the mailbox, the recipients, the subject and the full text with its line breaks; Approve sends nothing by itself", async () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join("\n");
  const calls: unknown[][] = [];
  const v = await render(
    approval({
      tool: "mailbox.mail_reply",
      message: "Send this mail from ana@example.invalid. It goes out in your name.",
      input: "From: ana@example.invalid",
      mail: {
        from: "ana@example.invalid",
        to: ["rui@example.invalid", "bia@example.invalid"],
        subject: "Re: Planning",
        text: long,
      },
    }),
    (...a) => calls.push(a),
  );
  const text = v.host.textContent ?? "";
  expect(text).toContain("wants to send a mail");
  expect(text).toContain("ana@example.invalid");
  expect(text).toContain("rui@example.invalid, bia@example.invalid");
  expect(text).toContain("Re: Planning");
  expect(text).toContain("Send this mail from ana@example.invalid");
  const body = v.host.querySelector("pre")!;
  expect(body.textContent).toBe(long);
  // Long text scrolls inside the card, and the line breaks are kept.
  expect(body.className).toContain("max-h-64");
  expect(body.className).toContain("overflow-auto");
  expect(body.className).toContain("whitespace-pre-wrap");
  expect(calls).toEqual([]);
  await v.press("Approve");
  expect(calls).toEqual([[true]]);
  await v.unmount();
});

test("a phone call shows the number formatted, the country, the longest, what happens on a machine and the briefing; Approve places nothing by itself", async () => {
  const calls: unknown[][] = [];
  const v = await render(
    approval({
      tool: "phone.phone_call",
      message: "Place this phone call to +12025550123 (United States).",
      input: "To: +12025550123",
      phone: {
        to: "+12025550123",
        country: "US",
        briefing: "Confirm the table for two at 3pm.\nSay the name is Ana.",
        maxMinutes: 5,
        voicemail: "hang_up",
      },
    }),
    (...a) => calls.push(a),
  );
  const text = v.host.textContent ?? "";
  expect(text).toContain("wants to make a phone call");
  expect(text).toContain("+1 (202) 555-0123");
  expect(text).toContain("United States");
  expect(text).toContain("5 minutes");
  expect(text).toContain("Hang up");
  expect(text).toContain("Confirm the table for two at 3pm.");
  expect(text).toContain("automated assistant");
  // No cost line when the server knows no rate.
  expect(text).not.toContain("a minute");
  expect(
    v.host.querySelector('pre[aria-label="What the call will say and ask"]')!.textContent,
  ).toContain("\n");
  expect(calls).toEqual([]);
  expect(v.buttons().map((b) => b.textContent)).toEqual(["Decline", "Approve"]);
  await v.press("Approve");
  expect(calls).toEqual([[true]]);
  await v.unmount();
});

test("a phone call shows the cost when the server gives a rate, and the voicemail message when one is left", async () => {
  const v = await render(
    approval({
      tool: "phone.phone_call",
      message: "",
      phone: {
        to: "+551155550123",
        country: "BR",
        briefing: "Hi",
        maxMinutes: 1,
        voicemail: "leave_message",
        costPerMinute: "0.05 USD",
      },
    }),
    () => {},
  );
  const text = v.host.textContent ?? "";
  expect(text).toContain("+55 11 5555-0123");
  expect(text).toContain("1 minute");
  expect(text).not.toContain("1 minutes");
  expect(text).toContain("About 0.05 USD a minute");
  expect(text).toContain("Leave the message");
  await v.unmount();
});
