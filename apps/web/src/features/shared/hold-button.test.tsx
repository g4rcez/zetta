import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const mount = async () => {
  const { HoldButton } = await import("./ui");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const calls: string[] = [];
  await act(async () =>
    root.render(
      <HoldButton holdMs={40} onHold={() => calls.push("held")}>
        Hold to approve
      </HoldButton>,
    ),
  );
  const button = host.querySelector("button") as unknown as HTMLElement;
  const fire = (type: string, key?: string) =>
    act(async () => {
      button.dispatchEvent(
        (key
          ? new win.KeyboardEvent(type, { bubbles: true, key })
          : new win.Event(type, { bubbles: true })) as never,
      );
    });
  const wait = (ms: number) =>
    act(async () => void (await new Promise((ok) => setTimeout(ok, ms))));
  return { calls, fire, wait, unmount: () => act(async () => root.unmount()) };
};

test("a click alone does not confirm", async () => {
  const { calls, fire, wait, unmount } = await mount();
  await fire("click");
  await wait(120);
  expect(calls).toEqual([]);
  await unmount();
});

test("holding the button confirms once", async () => {
  const { calls, fire, wait, unmount } = await mount();
  await fire("pointerdown");
  await wait(120);
  await fire("pointerup");
  expect(calls).toEqual(["held"]);
  await unmount();
});

test("letting go early starts over and confirms nothing", async () => {
  const { calls, fire, wait, unmount } = await mount();
  await fire("pointerdown");
  await wait(5);
  await fire("pointerup");
  await wait(120);
  expect(calls).toEqual([]);
  await unmount();
});

test("holding Space confirms for a keyboard user", async () => {
  const { calls, fire, wait, unmount } = await mount();
  await fire("keydown", " ");
  await wait(120);
  await fire("keyup", " ");
  expect(calls).toEqual(["held"]);
  await unmount();
});
