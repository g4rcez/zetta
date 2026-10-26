import { describe, expect, test } from "bun:test";
import { cell, humanize, size, tableLabel } from "./database-api";

describe("bot database labels", () => {
  test("tables read as the bot described them", () => {
    const t = (description: string | null) => ({ name: "due_tasks", description, columns: [], rows: 0, bytes: 0 });
    expect(tableLabel(t("Tasks: things to do"))).toEqual({ title: "Tasks", detail: "Things to do" });
    expect(tableLabel(t("Shopping list"))).toEqual({ title: "Shopping list", detail: "" });
    expect(tableLabel(t(null))).toEqual({ title: "Due tasks", detail: "" });
  });
  test("sizes and cells are plain", () => {
    expect([size(0), size(1500), size(50 * 1048576), size(1.5 * 1048576)]).toEqual(["0 KB", "2 KB", "50 MB", "1.5 MB"]);
    expect([humanize("created_at"), cell(true), cell(null), cell(["a", "b"]), cell({ a: 1 })]).toEqual(["Created at", "Yes", "", "a, b", '{"a":1}']);
  });
});
