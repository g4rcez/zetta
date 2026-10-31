import { describe, expect, test } from "bun:test";
import { looksSecret } from "./secrets";

describe("looksSecret", () => {
  test("flags tokens, keys and passwords people paste", () => {
    expect(looksSecret("here: ghp_abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(looksSecret("my token github_pat_11AAAAAAA0_bbbbbbbbbbbbbbbbbbbb")).toBe(true);
    expect(looksSecret("my key sk-test-abcdefghijklmnop1234")).toBe(true);
    expect(looksSecret("password: hunter22!")).toBe(true);
    expect(looksSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });

  test("leaves ordinary messages alone", () => {
    expect(looksSecret("Please read my unread email")).toBe(false);
    expect(looksSecret("The token field is empty")).toBe(false);
  });
});
