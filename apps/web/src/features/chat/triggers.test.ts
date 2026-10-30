import { describe, expect, test } from "bun:test";
import { instructionSummary, matchTrigger } from "./triggers";

describe("matchTrigger", () => {
  test("finds the word after the trigger char before the caret", () => {
    expect(matchTrigger("run /wee", 8, "/")).toEqual({ query: "wee", at: 4 });
    expect(matchTrigger("/", 1, "/")).toEqual({ query: "", at: 0 });
    expect(matchTrigger("ask @Dev", 8, "@")).toEqual({ query: "Dev", at: 4 });
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

describe("instructionSummary", () => {
  test("the trigger wins over the body", () => {
    expect(instructionSummary({ trigger: "Every Monday", body: "1. Open the board" })).toBe(
      "Every Monday",
    );
  });
  test("uses the first step without its list marker, skipping blank lines", () => {
    expect(instructionSummary({ body: "\n\n1. Open the board\n2. Post it" })).toBe(
      "Open the board",
    );
    expect(instructionSummary({ trigger: "  ", body: "- Check the logs" })).toBe("Check the logs");
  });
  test("empty body gives an empty string", () => {
    expect(instructionSummary({ body: "  \n " })).toBe("");
  });
});
