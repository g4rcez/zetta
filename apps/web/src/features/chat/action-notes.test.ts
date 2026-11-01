import { describe, expect, test } from "bun:test";

import { splitActionNotes } from "./action-notes";

describe("splitActionNotes", () => {
  test("moves trailing emoji notes out of the prose", () => {
    expect(
      splitActionNotes(
        "Done.\n\n🔓 Chief updated the permissions of components.\n\n🔐 components asked Chief for permission: Bash(pnpm:*).",
      ),
    ).toEqual({
      body: "Done.",
      notes: [
        "Chief updated the permissions of components.",
        "components asked Chief for permission: Bash(pnpm:*).",
      ],
    });
  });
  test("a published-artifact note after tool notes is a note too", () => {
    expect(
      splitActionNotes(
        "Twelve items.\n\n🔌 Used google.gmail_search\n\n📎 Published “Weekly · node” (html) in Artifacts.",
      ),
    ).toEqual({
      body: "Twelve items.",
      notes: ["Used google.gmail_search", "Published “Weekly · node” (html) in Artifacts."],
    });
  });
  test("keeps a reply that is only a note", () => {
    expect(splitActionNotes("🔌 Used github.search")).toEqual({
      body: "🔌 Used github.search",
      notes: [],
    });
  });
  test("ignores an emoji paragraph that is followed by prose", () => {
    expect(splitActionNotes("🔓 first\n\nthen text")).toEqual({
      body: "🔓 first\n\nthen text",
      notes: [],
    });
  });
  test("leaves notes inside an open code fence alone", () => {
    const text = "```\ncode\n\n🔓 not a note";
    expect(splitActionNotes(text)).toEqual({ body: text, notes: [] });
  });
});
