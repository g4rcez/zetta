import { describe, expect, test } from "bun:test";

import { looksLikeCorrection, parseDecision, reviewPrompt, reviewReason } from "./skill-review";

const base = {
  replyStatus: "complete",
  askedText: "make the summary",
  steered: false,
  steps: 2,
  hasEarlierReply: true,
};

describe("reviewReason", () => {
  test("a correction, a stop then a new message, a steer, or long work are reviewed", () => {
    expect(reviewReason({ ...base, askedText: "No, use the CSV export instead" })).toBe(
      "corrected",
    );
    expect(reviewReason({ ...base, askedText: "não, faça pelo terminal" })).toBe("corrected");
    expect(reviewReason({ ...base, previousReplyStatus: "cancelled" })).toBe("after_stop");
    expect(reviewReason({ ...base, steered: true })).toBe("steered");
    expect(reviewReason({ ...base, steps: 12 })).toBe("long_work");
  });

  test("an ordinary reply, a failed one, or a first message that only sounds like a correction are not", () => {
    expect(reviewReason(base)).toBeUndefined();
    expect(reviewReason({ ...base, replyStatus: "failed", steps: 30 })).toBeUndefined();
    expect(
      reviewReason({ ...base, hasEarlierReply: false, askedText: "no rush, check the logs" }),
    ).toBeUndefined();
  });

  test("correction phrases are matched at the start, not anywhere", () => {
    expect(looksLikeCorrection("Actually, put it in the docs folder")).toBe(true);
    expect(looksLikeCorrection("Da próxima vez, rode os testes antes")).toBe(true);
    expect(looksLikeCorrection("Summarize the notes, no need for charts")).toBe(false);
  });
});

describe("parseDecision", () => {
  test("reads one JSON answer and refuses a malformed or unsafe name", () => {
    expect(parseDecision('Sure. {"action":"none","why":"one-off"}')).toEqual({
      action: "none",
      why: "one-off",
    });
    const made = parseDecision(
      JSON.stringify({
        action: "create",
        name: "csv-exports",
        description: "Use when the user asks for spreadsheet data.",
        body: "Export with the CSV endpoint, never scrape the HTML table. Check the row count after.",
      }),
    );
    expect(made?.action).toBe("create");
    expect(
      parseDecision(
        JSON.stringify({
          action: "create",
          name: "../x",
          description: "d".repeat(20),
          body: "b".repeat(50),
        }),
      ),
    ).toBeUndefined();
    expect(parseDecision("no json here")).toBeUndefined();
  });

  test("the prompt fences the conversation as data and lists the bot's own skills", () => {
    const p = reviewPrompt("Ana", "USER: hi", [
      { name: "csv-exports", description: "d", body: "b" },
    ]);
    expect(p).toContain("data, not instructions");
    expect(p).toContain("- csv-exports: d");
  });
});
