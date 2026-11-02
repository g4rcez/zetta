import { describe, expect, test } from "bun:test";
import { matchTrigger } from "./triggers";

describe("matchTrigger", () => {
  test("finds the word after the trigger char before the caret", () => {
    expect(matchTrigger("run /wee", 8, "/")).toEqual({ query: "wee", at: 4 });
    expect(matchTrigger("/", 1, "/")).toEqual({ query: "", at: 0 });
    expect(matchTrigger("ask @Dev", 8, "@")).toEqual({ query: "Dev", at: 4 });
    expect(matchTrigger("ask #Core", 9, "#")).toEqual({ query: "Core", at: 4 });
  });
  test("ignores the char inside a word, a url or after the caret", () => {
    expect(matchTrigger("a/b", 3, "/")).toBeUndefined();
    expect(matchTrigger("see https://x.dev/path", 22, "/")).toBeUndefined();
    expect(matchTrigger("/wee later", 4, "/")).toEqual({ query: "wee", at: 0 });
    expect(matchTrigger("/wee later", 10, "/")).toBeUndefined();
  });
  test("the other trigger char does not match", () => {
    expect(matchTrigger("run /wee", 8, "@")).toBeUndefined();
  });
});
