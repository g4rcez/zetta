import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("splits rows and fields", () => {
    expect(parseCsv("a,b\n1,2\n").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  test("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    expect(parseCsv('name,note\n"Smith, Ann","said ""hi""\nthere"\r\nBob,ok').rows).toEqual([
      ["name", "note"],
      ["Smith, Ann", 'said "hi"\nthere'],
      ["Bob", "ok"],
    ]);
  });
  test("reads tab separated text", () => {
    expect(parseCsv("a\tb\n1\t2", "\t").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  test("stops at the row limit and reports it", () => {
    expect(parseCsv("1\n2\n3\n4\n", ",", 2)).toEqual({ rows: [["1"], ["2"]], truncated: true });
  });
});
