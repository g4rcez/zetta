import { expect, test } from "bun:test";

import { memoryUndo } from "./receipt-undo";

test("a new memory item is archived; a changed one goes back to the version before; a first version cannot be undone", () => {
  expect(memoryUndo({ kind: "memory", id: "units", text: "Units", created: true })).toEqual({
    path: "/api/memory/units",
    method: "PATCH",
    body: { status: "archived" },
  });
  expect(
    memoryUndo({ kind: "memory", id: "units", text: "Units", created: false, version: 4 }),
  ).toEqual({ path: "/api/memory/units/restore", method: "POST", body: { version: 3 } });
  expect(
    memoryUndo({ kind: "memory", id: "units", text: "Units", created: false }),
  ).toBeUndefined();
});
