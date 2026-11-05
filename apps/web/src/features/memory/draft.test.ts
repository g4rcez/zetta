import { describe, expect, test } from "bun:test";

import { decodeDraft, draftFromProposal, encodeDraft } from "./draft";

const draft = {
  action: "write" as const,
  slug: "wizdaa",
  title: "Wizdaa: ação rápida ✓",
  content: "# Passos\n\nUse [[outro-item]] e `code`.",
  howto: "Quando o deploy falhar",
  tags: ["deploy", "ops"],
};

describe("memory draft link", () => {
  test("a draft survives the trip through the URL, including accents and symbols", () => {
    const d = encodeDraft(draft);
    expect(d).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDraft(d)).toEqual(draft);
  });

  test("a link that is not a draft shows nothing", () => {
    expect(decodeDraft(undefined)).toBeUndefined();
    expect(decodeDraft("")).toBeUndefined();
    expect(decodeDraft("not a draft!")).toBeUndefined();
    expect(decodeDraft(btoa('{"action":"write","slug":"a"}'))).toBeUndefined();
  });

  test("a draft too big for a link gets no link", () => {
    expect(encodeDraft({ ...draft, content: "x".repeat(40_000) })).toBeUndefined();
  });

  test("a bot write, patch and link each have a preview; the draft keeps only known fields", () => {
    const write = { action: "write", slug: "wizdaa", title: "Wizdaa", content: "Body", score: 90 };
    expect(decodeDraft(draftFromProposal({ args: write }))).toEqual({
      action: "write",
      slug: "wizdaa",
      title: "Wizdaa",
      content: "Body",
      howto: "",
      tags: [],
    });
    const link = { action: "link" as const, slug: "wizdaa", to: "outro", relation: "depends-on" };
    expect(decodeDraft(draftFromProposal({ args: link }))).toEqual(link);
    const patch = { action: "patch" as const, slug: "wizdaa", match: "old", content: "new" };
    expect(decodeDraft(draftFromProposal({ args: patch }))).toEqual(patch);
    expect(decodeDraft(draftFromProposal({ args: { action: "archive", slug: "wizdaa" } }))).toEqual(
      {
        action: "archive",
        slug: "wizdaa",
      },
    );
  });

  test("a proposal with no memory change has no preview", () => {
    expect(draftFromProposal({ args: { action: "search", slug: "wizdaa" } })).toBeUndefined();
    expect(draftFromProposal(undefined)).toBeUndefined();
  });
});
