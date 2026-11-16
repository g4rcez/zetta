import { describe, expect, test } from "bun:test";
import { ORG_ICONS, ORG_ROLE_TEMPLATES } from "@zetta/core/org-templates";

import { BOT_TEMPLATES, templateById } from "../bots/bot-templates";

describe("role templates and bot templates", () => {
  test("a role that suggests a bot names a bot template that exists", () => {
    const suggested = ORG_ROLE_TEMPLATES.filter((t) => t.suggestedBotTemplate !== null);
    expect(suggested.length).toBeGreaterThan(5);
    for (const t of suggested)
      expect(
        templateById(t.suggestedBotTemplate!),
        `${t.key} suggests ${t.suggestedBotTemplate}`,
      ).toBeDefined();
  });

  test("every kind of bot template suits at least one role, so none is left out of the chart", () => {
    const used = new Set(ORG_ROLE_TEMPLATES.map((t) => t.suggestedBotTemplate));
    const unused = BOT_TEMPLATES.filter((b) => !used.has(b.id)).map((b) => b.id);
    // A tutor has no seat in a company chart on its own; any other gap is a role left out.
    expect(unused.filter((id) => id !== "tutor")).toEqual([]);
  });

  test("every icon a role uses is one the web app can draw", () => {
    for (const t of ORG_ROLE_TEMPLATES) expect(ORG_ICONS).toContain(t.icon);
  });
});
