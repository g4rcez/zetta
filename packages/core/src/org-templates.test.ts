import { describe, expect, test } from "bun:test";
import { ORG_DESCRIPTION_MAX, ORG_TITLE_MAX, ORG_UNIT_MAX, validateTree } from "./org";
import {
  ORG_ICONS,
  ORG_PRESETS,
  ORG_ROLE_TEMPLATES,
  ORG_TEMPLATE_CATEGORIES,
  orgPresetByKey,
  orgTemplateByKey,
  presetRows,
  type OrgPresetNode,
} from "./org-templates";

const keysOf = (node: OrgPresetNode): string[] => [
  node.template,
  ...(node.children ?? []).flatMap(keysOf),
];

describe("org role templates", () => {
  test("keys are unique, lowercase and made of letters and dashes", () => {
    const keys = ORG_ROLE_TEMPLATES.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  test("every text fits the limits of a seat and says something", () => {
    for (const x of ORG_ROLE_TEMPLATES) {
      expect(x.title.length).toBeGreaterThan(0);
      expect(x.title.length).toBeLessThanOrEqual(ORG_TITLE_MAX);
      expect(x.unit.length).toBeLessThanOrEqual(ORG_UNIT_MAX);
      expect(x.description.length).toBeGreaterThan(20);
      expect(x.description.length).toBeLessThanOrEqual(ORG_DESCRIPTION_MAX);
      expect(x.decides.length).toBeGreaterThan(10);
      expect(x.goesUp.length).toBeGreaterThan(10);
    }
  });

  test("categories and icons are known, and every category has a seat", () => {
    const categories = ORG_TEMPLATE_CATEGORIES.map((c) => c.id);
    for (const x of ORG_ROLE_TEMPLATES) {
      expect(categories).toContain(x.category);
      expect(ORG_ICONS).toContain(x.icon);
    }
    for (const c of categories) expect(ORG_ROLE_TEMPLATES.some((x) => x.category === c)).toBe(true);
  });

  test("only the CEO template has the CEO rank", () => {
    expect(ORG_ROLE_TEMPLATES.filter((x) => x.rank === "ceo").map((x) => x.key)).toEqual(["ceo"]);
  });

  test("there is a template of every kind of seat a company needs", () => {
    for (const key of ["ceo", "cto", "cfo", "eng-manager", "software-engineer", "support-agent"])
      expect(orgTemplateByKey(key)).toBeDefined();
    expect(ORG_ROLE_TEMPLATES.length).toBeGreaterThanOrEqual(20);
  });
});

describe("org presets", () => {
  test("keys are unique and every seat of a preset is a template", () => {
    const keys = ORG_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of ORG_PRESETS)
      for (const k of keysOf(p.root)) expect(orgTemplateByKey(k)).toBeDefined();
  });

  test("a company preset starts with the CEO; a department preset starts below it", () => {
    for (const p of ORG_PRESETS) {
      const root = orgTemplateByKey(p.root.template)!;
      expect(root.rank === "ceo").toBe(p.scope === "company");
    }
    expect(ORG_PRESETS.some((p) => p.scope === "company")).toBe(true);
    expect(ORG_PRESETS.some((p) => p.scope === "department")).toBe(true);
  });

  test("a preset flattens to rows that make a sound chart, parents first", () => {
    for (const p of ORG_PRESETS) {
      const rows = presetRows(p);
      expect(rows.length).toBe(keysOf(p.root).length);
      rows.forEach((r, i) => {
        expect(r.ref).toBe(i);
        if (r.parentRef !== null) expect(r.parentRef).toBeLessThan(i);
      });
      // A department preset is checked under a CEO, the way the server places it.
      const nodes = rows.map((r) => ({
        id: String(r.ref + 1),
        parentId:
          r.parentRef === null ? (p.scope === "company" ? null : "0") : String(r.parentRef + 1),
        rank: r.rank,
      }));
      if (p.scope === "department") nodes.unshift({ id: "0", parentId: null, rank: "ceo" });
      expect(validateTree(nodes)).toBeNull();
    }
  });

  test("siblings are numbered in the order the preset lists them", () => {
    const rows = presetRows(orgPresetByKey("small-startup")!);
    const underCeo = rows.filter((r) => r.parentRef === 0).map((r) => r.sortOrder);
    expect(underCeo).toEqual(underCeo.map((_, i) => i));
  });

  test("a seat keeps its template title and unit unless the preset overrides them", () => {
    const [root] = presetRows({
      key: "x",
      title: "x",
      description: "x",
      scope: "company",
      root: { template: "ceo", title: "Founder", unit: "Studio" },
    });
    expect(root).toMatchObject({ title: "Founder", unit: "Studio", templateKey: "ceo" });
    expect(presetRows(orgPresetByKey("solo-founder")!)[0]).toMatchObject({
      title: "CEO",
      unit: "Company",
    });
  });

  test("an unknown template drops its subtree instead of building half a chart", () => {
    const rows = presetRows({
      key: "x",
      title: "x",
      description: "x",
      scope: "company",
      root: {
        template: "ceo",
        children: [{ template: "nope", children: [{ template: "cto" }] }, { template: "cfo" }],
      },
    });
    expect(rows.map((r) => r.templateKey)).toEqual(["ceo", "cfo"]);
  });
});
