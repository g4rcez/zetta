import { describe, expect, test } from "bun:test";
import { parseTools, toolPreamble } from "./tools";

const fence = (body: unknown) => "```zetta:skills\n" + JSON.stringify(body) + "\n```";

describe("zetta:skills", () => {
  test("a search and an install are read, and the block is removed from the reply", () => {
    const r = parseTools(
      `Looking.\n${fence({ action: "search", query: "interview" })}\n${fence({ action: "install", source: "acme/skills", names: ["pdf"] })}\nDone.`,
    );
    expect(r.calls).toEqual([
      { kind: "skills", args: { action: "search", query: "interview" } },
      { kind: "skills", args: { action: "install", source: "acme/skills", names: ["pdf"] } },
    ]);
    expect(r.text).toBe("Looking.\n\n\nDone.");
    expect(r.rejected).toEqual([]);
  });
  test("an install can name the bots it is for; more than 12 are rejected", () => {
    const ok = parseTools(
      fence({ action: "install", source: "acme/skills", bots: ["Dana", "Eli"] }),
    );
    expect(ok.calls[0]?.args).toMatchObject({ bots: ["Dana", "Eli"] });
    const many = Array.from({ length: 13 }, (_, i) => `Bot${i}`);
    expect(
      parseTools(fence({ action: "install", source: "acme/skills", bots: many })).calls,
    ).toEqual([]);
  });
  test("an unknown action, a missing source and too many names are rejected with a reason", () => {
    const r = parseTools(
      [
        fence({ action: "remove", source: "acme/skills" }),
        fence({ action: "install" }),
        fence({
          action: "install",
          source: "acme/skills",
          names: Array.from({ length: 26 }, (_, i) => `s${i}`),
        }),
      ].join("\n"),
    );
    expect(r.calls).toEqual([]);
    expect(r.rejected.map((x) => x.kind)).toEqual(["skills", "skills", "skills"]);
  });
  test("the prompt describes the tool only when it is asked to, and says nothing is installed until the person agrees", () => {
    expect(toolPreamble("off", false, false)).not.toContain("zetta:skills");
    const text = toolPreamble("off", false, false, true);
    expect(text).toContain("zetta:skills");
    expect(text).toContain("Nothing is installed until they press Install");
  });
});
