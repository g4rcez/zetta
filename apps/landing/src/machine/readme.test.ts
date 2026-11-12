import { describe, expect, test } from "bun:test";

import { README_SECTIONS, readmeMarkdown, readmeSections } from "./readme";

const raw = [
  "# Zetta",
  "",
  "Intro text.",
  "",
  "## Install",
  "",
  "Run `curl`.",
  "See [the guide](docs/wiki/README.md) and [site](https://example.invalid).",
  "",
  "## See it in action",
  "",
  "[![Poster](docs/demo/poster.png)](docs/demo/video.mp4)",
  "",
  "![A picture](docs/demo/a.png)",
  "",
  "## What bots do",
  "",
  "- one",
  "",
  "## Interface references",
  "",
  "Not wanted.",
].join("\n");

describe("readmeSections", () => {
  test("splits at the ## headings and ignores the text before the first", () => {
    const s = readmeSections(raw);
    expect([...s.keys()]).toEqual([
      "Install",
      "See it in action",
      "What bots do",
      "Interface references",
    ]);
    expect(s.get("Install")).toContain("Run `curl`.");
    expect(s.has("Intro text.")).toBe(false);
  });
});

describe("readmeMarkdown", () => {
  test("keeps only the wanted sections, in the README's order, one heading each", () => {
    const md = readmeMarkdown(raw, ["What bots do", "Install", "Missing"]);
    expect(md.indexOf("### Install")).toBeLessThan(md.indexOf("### What bots do"));
    expect(md).not.toContain("See it in action");
    expect(md).not.toContain("Not wanted");
  });
  test("a relative link points at the file on GitHub; other links stay", () => {
    const md = readmeMarkdown(raw, ["Install"]);
    expect(md).toContain(
      "[the guide](https://github.com/g4rcez/zetta/blob/main/docs/wiki/README.md)",
    );
    expect(md).toContain("[site](https://example.invalid)");
  });
  test("pictures and linked posters do not travel in text", () => {
    const md = readmeMarkdown(raw, ["See it in action"]);
    expect(md).not.toContain("![");
    expect(md).not.toContain("poster.png");
  });
  test("the default sections are the ones a visitor needs", () => {
    expect(README_SECTIONS).toContain("Install");
    expect(README_SECTIONS).not.toContain("See it in action");
  });
});
