import { expect, test } from "bun:test";

import { browserPlacement, desktopTargets } from "./placement";

test("a server open to the network never runs a bot's browser on itself", () => {
  expect(browserPlacement("network", "host").ok).toBe(false);
  expect(browserPlacement("network", "docker").ok).toBe(true);
  expect(browserPlacement("local", "host").ok).toBe(true);
});

test("this machine's own desktop is offered only on a local install", () => {
  const all = { vm: true, remote: true, host: true };
  expect(desktopTargets("local", all)).toEqual(["vm", "cua", "local"]);
  expect(desktopTargets("network", all)).toEqual(["vm", "cua"]);
  expect(desktopTargets("local", { vm: false, remote: false, host: true })).toEqual(["local"]);
});
