import { expect, test } from "bun:test";
import { diffStats, lineDiff } from "./diff";

const show = (a: string, b: string) =>
  lineDiff(a, b).map((l) => `${l.kind === "same" ? " " : l.kind === "add" ? "+" : "-"}${l.text}`);

test("equal texts have no changes", () => {
  expect(show("a\nb", "a\nb")).toEqual([" a", " b"]);
  expect(diffStats(lineDiff("a\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
});
test("a changed line is a removal and an addition in place", () => {
  expect(show("one\ntwo\nthree", "one\n2\nthree")).toEqual([" one", "-two", "+2", " three"]);
});
test("added and removed lines at the start, middle and end", () => {
  expect(show("b\nc", "a\nb\nc\nd")).toEqual(["+a", " b", " c", "+d"]);
  expect(show("a\nb\nc\nd", "b\nc")).toEqual(["-a", " b", " c", "-d"]);
  expect(show("a\nx\nb\ny\nc", "a\nb\nc")).toEqual([" a", "-x", " b", "-y", " c"]);
});
test("everything differs", () => {
  expect(show("a", "b")).toEqual(["-a", "+b"]);
  expect(show("", "new")).toEqual(["-", "+new"]);
});
test("a moved block is shown as removed and added, never lost", () => {
  const lines = lineDiff("a\nb\nc\nd", "c\nd\na\nb");
  const after = lines.filter((l) => l.kind !== "del").map((l) => l.text);
  const before = lines.filter((l) => l.kind !== "add").map((l) => l.text);
  expect(after).toEqual(["c", "d", "a", "b"]);
  expect(before).toEqual(["a", "b", "c", "d"]);
});
test("applying the diff to the old text gives the new text, for many random edits", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 200; n++) {
    const a = Array.from({ length: Math.floor(rnd() * 12) }, () => `l${Math.floor(rnd() * 6)}`);
    const b = Array.from({ length: Math.floor(rnd() * 12) }, () => `l${Math.floor(rnd() * 6)}`);
    const lines = lineDiff(a.join("\n"), b.join("\n"));
    expect(
      lines
        .filter((l) => l.kind !== "add")
        .map((l) => l.text)
        .join("\n"),
    ).toBe(a.join("\n"));
    expect(
      lines
        .filter((l) => l.kind !== "del")
        .map((l) => l.text)
        .join("\n"),
    ).toBe(b.join("\n"));
  }
});
test("a very large change falls back to remove-all and add-all but keeps the shared start and end", () => {
  const big = (p: string) => Array.from({ length: 2000 }, (_, i) => `${p}${i}`).join("\n");
  const lines = lineDiff(`top\n${big("x")}\nend`, `top\n${big("y")}\nend`);
  expect(lines[0]).toEqual({ kind: "same", text: "top" });
  expect(lines.at(-1)).toEqual({ kind: "same", text: "end" });
  expect(diffStats(lines)).toEqual({ added: 2000, removed: 2000 });
});
