import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

let failing = false;
const calls: string[] = [];
const start = async () => {
  calls.push("start");
  if (failing) throw new Error("Too many codes. Wait a few minutes.");
  return {
    code: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    expiresAt: new Date(Date.now() + 180_000).toISOString(),
  };
};

const QR = 'svg[aria-label="QR code that signs in a phone"]';
const wait = (ms = 60) => act(async () => void (await new Promise((ok) => setTimeout(ok, ms))));
const mount = async () => {
  const { PairPhoneCard } = await import("./pair-phone-card");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<PairPhoneCard start={start} />));
  const button = () => host.querySelector("button") as unknown as HTMLButtonElement;
  return { host, button, unmount: () => act(async () => root.unmount()) };
};

test("pairing shows a QR code and how long it works", async () => {
  const { host, button, unmount } = await mount();
  expect(host.querySelector(QR)).toBeNull();
  await act(async () => button().click());
  await wait();
  const svg = host.querySelector(QR) as unknown as SVGElement;
  expect(svg.getAttribute("aria-label")).toBe("QR code that signs in a phone");
  expect(
    (svg.querySelector("path") as unknown as SVGElement).getAttribute("d")?.length,
  ).toBeGreaterThan(100);
  expect(host.textContent).toContain("Works once. Valid for 3:00");
  expect(button().textContent).toBe("New code");
  expect(calls).toEqual(["start"]);
  await unmount();
});

test("a refused code shows why and no QR code", async () => {
  failing = true;
  const { host, button, unmount } = await mount();
  await act(async () => button().click());
  await wait();
  expect(host.querySelector(QR)).toBeNull();
  expect(host.textContent).toContain("Too many codes. Wait a few minutes.");
  failing = false;
  await unmount();
});
