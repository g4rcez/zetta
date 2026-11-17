import { expect, test } from "bun:test";

import { resolveSidebarLayout } from "./sidebar-layout";

test("a solo account starts in the personal layout", () => {
  expect(resolveSidebarLayout(null, 1, null)).toBe("personal");
});

test("a workspace with a team starts in the workspace layout", () => {
  expect(resolveSidebarLayout(null, 2, null)).toBe("workspace");
});

test("the person's own choice beats the member count", () => {
  expect(resolveSidebarLayout("personal", 9, null)).toBe("personal");
  expect(resolveSidebarLayout("workspace", 1, null)).toBe("workspace");
});

test("while members load, the last automatic answer shows; with none, personal", () => {
  expect(resolveSidebarLayout(null, undefined, "workspace")).toBe("workspace");
  expect(resolveSidebarLayout(null, undefined, null)).toBe("personal");
});
