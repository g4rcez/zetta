import { describe, expect, test } from "bun:test";
import { extractLinks } from "./task-links";

const origin = "https://zetta.example.invalid";

describe("extractLinks", () => {
  test("reads markdown links and bare urls, once each, in order", () => {
    const links = extractLinks(
      [
        "See [the spec](https://example.invalid/spec) and https://example.invalid/pr/7.",
        "Again: https://example.invalid/spec",
      ],
      origin,
    );
    expect(links).toEqual([
      { url: "https://example.invalid/spec", label: "the spec", internal: false },
      { url: "https://example.invalid/pr/7", label: "example.invalid/pr/7", internal: false },
    ]);
  });

  test("turns links to this app into paths", () => {
    const links = extractLinks(
      ["[chat](/chat/abc)", "https://zetta.example.invalid/artifacts/1?x=2"],
      origin,
    );
    expect(links).toEqual([
      { url: "/chat/abc", label: "chat", internal: true },
      { url: "/artifacts/1?x=2", label: "/artifacts/1?x=2", internal: true },
    ]);
  });

  test("drops unsafe schemes and protocol-relative urls", () => {
    expect(
      extractLinks(
        ["[x](javascript:alert(1)) [y](//evil.example.invalid) [z](mailto:a@example.invalid)"],
        origin,
      ),
    ).toEqual([]);
  });
});
