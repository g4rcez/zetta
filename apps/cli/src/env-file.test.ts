import { describe, expect, test } from "bun:test";
import { readEnv, upsertEnv } from "./env-file";

describe("upsertEnv", () => {
  test("replaces a key in place and keeps comments and unknown lines", () => {
    const before = "# server\nCORS_ORIGIN=http://localhost:3001\nOTHER=1\n";
    expect(upsertEnv(before, { CORS_ORIGIN: "https://192.168.1.10:3001" })).toBe(
      "# server\nCORS_ORIGIN=https://192.168.1.10:3001\nOTHER=1\n",
    );
  });
  test("appends a missing key after a file without a final newline", () => {
    expect(upsertEnv("A=1", { B: "2" })).toBe("A=1\nB=2\n");
  });
  test("creates the text of an empty file", () => {
    expect(upsertEnv("", { B: "2" })).toBe("B=2\n");
  });
  test("keeps a value that has a dollar sign", () => {
    expect(upsertEnv("A=1\n", { A: "x$&y" })).toBe("A=x$&y\n");
  });
});

describe("readEnv", () => {
  test("reads a value, and treats a missing key and an empty value as unset", () => {
    expect(readEnv("A=1\nB=\n", "A")).toBe("1");
    expect(readEnv("A=1\nB=\n", "B")).toBe("");
    expect(readEnv("A=1\n", "C")).toBeUndefined();
  });
});
