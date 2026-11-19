import { describe, expect, test } from "bun:test";
import { jaccard, relevant, saidOutright, tokens, topicTag } from "./text";

describe("tokens and similarity", () => {
  test("meaningful words only: lower case, no accents, no filler, no repeats", () => {
    expect(tokens("Always send the Reports as a TABLE, not as a table of text")).toEqual([
      "always",
      "send",
      "reports",
      "table",
      "text",
    ]);
    expect(tokens("Relatório em português, não em inglês")).toEqual([
      "relatorio",
      "portugues",
      "ingles",
    ]);
  });

  test("the same lesson in other words is close, a different one is not", () => {
    expect(
      jaccard("Send reports as a table", "Always send the reports as a table"),
    ).toBeGreaterThanOrEqual(0.6);
    // One changed word is not the same lesson: no stemming, no loose matching.
    expect(jaccard("Send reports as a table", "Send invoices as a table")).toBeLessThan(0.6);
    expect(jaccard("Send reports as a table", "Use the CSV export for sales data")).toBeLessThan(
      0.2,
    );
    expect(jaccard("", "anything")).toBe(0);
  });
});

describe("relevant", () => {
  const lesson = {
    text: "Send client reports as a table",
    topic: "reports",
    scope: "topic" as const,
  };
  test("a lesson about reports matters for a message about reports, not for one about parking", () => {
    expect(relevant(lesson, "Can you make the weekly report for Acme?")).toBe(false); // "report" is not "reports": no stemming on purpose
    expect(relevant(lesson, "Please send the client reports for Acme")).toBe(true);
    expect(relevant(lesson, "Where do I park on Monday?")).toBe(false);
  });
  test("a lesson for every reply matters for every reply", () => {
    expect(relevant({ ...lesson, scope: "always" }, "Where do I park on Monday?")).toBe(true);
  });
});

describe("saidOutright", () => {
  test("a rule in the person's own words, in English and Portuguese", () => {
    for (const t of [
      "From now on send the reports as a table",
      "Always answer in Portuguese",
      "never use the old export",
      "A partir de agora, mande em tabela",
      "Nunca responda em inglês",
      "Da próxima vez use o CSV",
    ])
      expect(saidOutright(t)).toBe(true);
    for (const t of [
      "No, use the CSV this time",
      "Not like that, shorter please",
      "Ótimo, continue",
    ])
      expect(saidOutright(t)).toBe(false);
  });
});

describe("topicTag", () => {
  test("a label that is a valid tag", () => {
    expect(topicTag("Client reports & invoices!")).toBe("client-reports-invoices");
    expect(topicTag("Relatório")).toBe("relatorio");
    expect(topicTag("   ")).toBe("");
  });
});
