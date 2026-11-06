import { describe, expect, test } from "bun:test";
import { hasKeyFormat, looksSecret } from "./secrets";

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

describe("hasKeyFormat", () => {
  test("flags credential formats in code", () => {
    expect(hasKeyFormat("KEY = 'sk-test-abcdefghijklmnop1234'")).toBe(true);
    expect(hasKeyFormat("-----BEGIN PRIVATE KEY-----")).toBe(true);
  });

  test("leaves hashes and token assignments in scripts alone", () => {
    expect(hasKeyFormat("token = os.environ.get('GITHUB_TOKEN')")).toBe(false);
    expect(hasKeyFormat("commit 0123456789abcdef0123456789abcdef01234567")).toBe(false);
    expect(looksSecret("token = os.environ.get('GITHUB_TOKEN')")).toBe(true);
  });
});
