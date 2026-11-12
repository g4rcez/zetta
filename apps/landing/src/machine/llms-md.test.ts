import { describe, expect, test } from "bun:test";

import { buildLlmsFull, buildLlmsTxt } from "./llms-md";

const guides = [
  {
    slug: "getting-started",
    title: "Your first bot",
    summary: "Start small.",
    markdown: "# Your first bot\n\nStart small.\n",
  },
  { slug: "privacy", title: "Privacy", summary: "", markdown: "# Privacy\n\nText.\n" },
];
const days = [
  {
    day: "2026-11-12",
    entries: [{ type: "feat" as const, scope: "chat", subject: "polls", sha: "abc1234" }],
  },
];

describe("buildLlmsTxt", () => {
  const txt = buildLlmsTxt({ description: "A short description.", guides });

  test("follows the llms.txt shape: a title, a summary quote and linked sections", () => {
    expect(txt.startsWith("# Zetta\n\n> A short description.\n")).toBe(true);
    expect(txt).toContain("\n## Docs\n");
    expect(txt).toContain("\n## Optional\n");
  });
  test("links the Markdown of every guide page, with its summary when there is one", () => {
    expect(txt).toContain(
      "- [Your first bot](https://zettabot.app/docs/getting-started.md): Start small.",
    );
    expect(txt).toContain("- [Privacy](https://zettabot.app/docs/privacy.md)\n");
  });
  test("links the home page, both changelogs, the full file and the Portuguese page", () => {
    for (const path of [
      "index.md",
      "changelog.md",
      "changelog.json",
      "llms-full.txt",
      "pt-br/index.md",
    ])
      expect(txt).toContain(`https://zettabot.app/${path}`);
  });
  test("every site link ends in a file the build writes", () => {
    const links = [...txt.matchAll(/\(https:\/\/zettabot\.app\/([^)]+)\)/g)].map((m) => m[1]!);
    for (const l of links) expect(l).toMatch(/\.(md|json|txt)$/);
  });
});

describe("buildLlmsFull", () => {
  const full = buildLlmsFull({ home: "# Home\n", readme: "### Install\n\nRun.", guides, days });
  test("holds the home page, the README sections, every guide page and the changelog", () => {
    expect(full).toContain("# Home");
    expect(full).toContain("## From the README");
    expect(full).toContain("### Install");
    expect(full).toContain("# Your first bot");
    expect(full).toContain("# Privacy");
    expect(full).toContain("- **New** (chat): polls");
  });
  test("parts are separated by a rule, and the file ends with one newline", () => {
    expect(full.split("\n---\n").length).toBeGreaterThanOrEqual(4);
    expect(full.endsWith("\n")).toBe(true);
    expect(full.endsWith("\n\n")).toBe(false);
  });
  test("says the guide is the intended journey", () => {
    expect(full).toContain("intended v1 journey");
  });
});
