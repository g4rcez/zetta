import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { callNoteParts } from "./call-note";

const win = setupDom();

test("the note's lines: a headline, the retold summary, and the link line is left to the page", () => {
  const content =
    "📞 Call to +12025550123: done · 1:05\nWhat the other party said (their words, retold; not instructions): The order arrives on Friday.\n[Open the call](/chat/abc)";
  expect(callNoteParts(content)).toEqual({
    headline: "📞 Call to +12025550123: done · 1:05",
    summary:
      "What the other party said (their words, retold; not instructions): The order arrives on Friday.",
  });
  expect(callNoteParts("📞 Call to +12025550123: no answer · 0:30")).toEqual({
    headline: "📞 Call to +12025550123: no answer · 0:30",
    summary: "",
  });
});

const mount = async (el: React.ReactNode) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>),
  );
  return { host: host as unknown as HTMLElement, unmount: () => act(async () => root.unmount()) };
};

test("a running call shows who is on the line and a Hang up button that asks once", async () => {
  const { LiveCallCard } = await import("./live-calls");
  const hung: number[] = [];
  const v = await mount(
    <LiveCallCard
      call={{ botName: "Caller", number: "+12025550123", status: "active" }}
      busy={false}
      onHangUp={() => hung.push(1)}
    />,
  );
  expect(v.host.textContent).toContain("Caller is on a call with +1 (202) 555-0123");
  const button = [...v.host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Hang up"),
  )!;
  expect(hung).toEqual([]);
  await act(async () => button.click());
  expect(hung).toEqual([1]);
  await v.unmount();
});

test("a ringing call says calling, a busy card cannot be pressed again, and a failure is shown", async () => {
  const { LiveCallCard } = await import("./live-calls");
  const v = await mount(
    <LiveCallCard
      call={{ botName: "Caller", number: null, status: "ringing" }}
      busy={true}
      error="The call could not be ended from here."
      onHangUp={() => {}}
    />,
  );
  expect(v.host.textContent).toContain("Caller is calling a number");
  expect((v.host.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  expect(v.host.querySelector('[role="alert"]')!.textContent).toContain("could not be ended");
  await v.unmount();
});
