import { expect, test } from "bun:test";

import type { Receipt } from "./chat-client";
import { uniqueReceipts } from "./receipts";

const task = (id: string, text: string, rest: Partial<Receipt> = {}): Receipt => ({
  kind: "task",
  id,
  text,
  ...rest,
});

test("receipts that are all different come back untouched", () => {
  const list: Receipt[] = [
    task("a", "One"),
    task("b", "Two"),
    { kind: "agenda", id: "a", text: "Same id" },
  ];
  expect(uniqueReceipts(list)).toBe(list);
});

test("a task saved twice in one reply shows once, with the newest title", () => {
  const out = uniqueReceipts([
    task("a", "Old", { created: true }),
    task("b", "Other"),
    task("a", "New", { created: false }),
  ]);
  expect(out.map((r) => `${r.id}:${r.text}`)).toEqual(["a:New", "b:Other"]);
});

test("a task created and then updated still reads as added", () => {
  const [r] = uniqueReceipts([
    task("a", "T", { created: true }),
    task("a", "T", { created: false }),
  ]);
  expect(r!.created).toBe(true);
});

test("two updates of one task stay an update", () => {
  const [r] = uniqueReceipts([
    task("a", "T", { created: false }),
    task("a", "T", { created: false }),
  ]);
  expect(r!.created).toBe(false);
});

test("the same id under another kind is a different receipt", () => {
  const list: Receipt[] = [task("a", "T"), { kind: "agenda", id: "a", text: "A" }, task("a", "T")];
  const out = uniqueReceipts(list);
  expect(out.map((r) => r.kind)).toEqual(["task", "agenda"]);
});

test("a handed-over task keeps its assignee when the same task is assigned again", () => {
  const assignee = { botId: "bot", name: "Frontend" };
  const [r] = uniqueReceipts([
    task("a", "T", { created: true, assignee, doneWhen: "tests pass" }),
    task("a", "T", { created: false, assignee, doneWhen: "tests and lint pass" }),
  ]);
  expect(r).toMatchObject({ assignee, doneWhen: "tests and lint pass", created: true });
});
