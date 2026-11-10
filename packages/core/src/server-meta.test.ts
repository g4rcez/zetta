import { describe, expect, test } from "bun:test";

import {
  buildServerMeta,
  buildWellKnown,
  normalizeOrigin,
  parseServerMeta,
  parseWellKnown,
  SERVER_PROTOCOL,
} from "./server-meta";

describe("normalizeOrigin", () => {
  test("keeps the origin of an http(s) address", () => {
    expect(normalizeOrigin("https://zetta.example.invalid/chat?x=1#h")).toBe(
      "https://zetta.example.invalid",
    );
    expect(normalizeOrigin(" http://localhost:3000/ ")).toBe("http://localhost:3000");
  });

  test("refuses other schemes, credentials and garbage", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "views://mainview",
      "ftp://a.invalid",
      "https://u:p@a.invalid",
      "not a url",
      "",
      7,
      null,
    ]) {
      expect(normalizeOrigin(bad)).toBeNull();
    }
  });
});

describe("parseServerMeta", () => {
  const meta = buildServerMeta("https://zetta.example.invalid", "https://api.example.invalid");

  test("round-trips what the server sends", () => {
    expect(parseServerMeta(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
  });

  test("normalizes the origins it is given", () => {
    expect(
      parseServerMeta({ ...meta, webOrigin: "https://zetta.example.invalid/app/" })?.webOrigin,
    ).toBe("https://zetta.example.invalid");
  });

  test("refuses another product, a newer protocol and bad origins", () => {
    expect(parseServerMeta({ ...meta, name: "other" })).toBeNull();
    expect(parseServerMeta({ ...meta, protocol: SERVER_PROTOCOL + 1 })).toBeNull();
    expect(parseServerMeta({ ...meta, protocol: 0 })).toBeNull();
    expect(parseServerMeta({ ...meta, apiOrigin: "javascript:1" })).toBeNull();
    expect(parseServerMeta("zetta")).toBeNull();
    expect(parseServerMeta(null)).toBeNull();
  });
});

describe("well-known", () => {
  test("round-trips and normalizes the API origin", () => {
    expect(parseWellKnown(buildWellKnown("https://api.example.invalid/x"))).toEqual({
      name: "zetta",
      protocol: 1,
      apiOrigin: "https://api.example.invalid",
    });
  });

  test("refuses a bad API origin or another product", () => {
    expect(
      parseWellKnown({ ...buildWellKnown("https://a.invalid"), apiOrigin: "file:///x" }),
    ).toBeNull();
    expect(parseWellKnown({ name: "x", protocol: 1, apiOrigin: "https://a.invalid" })).toBeNull();
    expect(parseWellKnown(undefined)).toBeNull();
  });
});
