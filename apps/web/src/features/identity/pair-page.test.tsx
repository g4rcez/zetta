import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const mount = async (code: string, redeem: (code: string) => Promise<void>) => {
  const { PairPage } = await import("./pair-page");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const calls: string[] = [];
  await act(async () =>
    root.render(
      <PairPage
        code={code}
        redeem={redeem}
        onDone={() => calls.push("done")}
        onSignIn={() => calls.push("sign in")}
      />,
    ),
  );
  return { host, calls, unmount: () => act(async () => root.unmount()) };
};

test("a good code signs the phone in and moves on", async () => {
  const spent: string[] = [];
  const { calls, unmount } = await mount("good-code", async (c) => void spent.push(c));
  expect(spent).toEqual(["good-code"]);
  expect(calls).toEqual(["done"]);
  await unmount();
});

test("a code the server refuses shows why, with a way to sign in by email", async () => {
  const { host, calls, unmount } = await mount("old-code", async () => {
    throw new Error("This code is not valid anymore.");
  });
  expect(host.textContent).toContain("This phone was not signed in");
  expect(host.textContent).toContain("This code is not valid anymore.");
  const button = host.querySelector("button") as unknown as HTMLElement;
  await act(async () => button.click());
  expect(calls).toEqual(["sign in"]);
  await unmount();
});

test("an address with no code asks for a new one and does not call the server", async () => {
  const spent: string[] = [];
  const { host, unmount } = await mount("", async (c) => void spent.push(c));
  expect(host.textContent).toContain("Make a new one on your computer");
  expect(spent).toEqual([]);
  await unmount();
});
