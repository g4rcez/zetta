import { expect, test } from "bun:test";
import { categoriesOf, describeSchedule, filterCatalog } from "./grok-filter";
import type { GrokListItem } from "./grok-api";

const item = (id: string, over: Partial<GrokListItem> = {}): GrokListItem => ({
  id,
  name: `Example ${id}`,
  creatorName: "Example Creator",
  handle: null,
  summary: `Summary of ${id}.`,
  categories: ["Operations"],
  color: "blue",
  shape: "circle",
  imageUrl: null,
  avatar: { kind: "preset", preset: "circle", colors: ["#4a80e6"] },
  ...over,
});
const items = [
  item("alpha", {
    name: "Outbound Prospecting",
    creatorName: "Ada",
    summary: "Finds leads.",
    categories: ["Sales"],
  }),
  item("beta", {
    name: "SEO Desk",
    creatorName: "Grace",
    summary: "Tracks rankings and answers.",
    categories: ["Marketing", "Sales"],
  }),
  item("gamma", {
    name: "Recruiting Coordinator",
    creatorName: "Linus",
    summary: "Schedules interviews.",
    categories: ["Recruiting & People"],
  }),
];

test("no filter shows everything, in the catalog's order", () => {
  expect(filterCatalog(items, "", "").map((i) => i.id)).toEqual(["alpha", "beta", "gamma"]);
});

test("words match the name, the creator and the summary, ignoring case", () => {
  expect(filterCatalog(items, "prospecting", "").map((i) => i.id)).toEqual(["alpha"]);
  expect(filterCatalog(items, "GRACE", "").map((i) => i.id)).toEqual(["beta"]);
  expect(filterCatalog(items, "interviews", "").map((i) => i.id)).toEqual(["gamma"]);
});

test("every word must match, in any order", () => {
  expect(filterCatalog(items, "rankings seo", "").map((i) => i.id)).toEqual(["beta"]);
  expect(filterCatalog(items, "seo leads", "")).toEqual([]);
});

test("a category keeps the bots that have it", () => {
  expect(filterCatalog(items, "", "Sales").map((i) => i.id)).toEqual(["alpha", "beta"]);
  expect(filterCatalog(items, "seo", "Sales").map((i) => i.id)).toEqual(["beta"]);
  expect(filterCatalog(items, "", "Nope")).toEqual([]);
});

test("the categories of a catalog, most common first, then by name", () => {
  expect(categoriesOf(items)).toEqual(["Sales", "Marketing", "Recruiting & People"]);
});

test("the days of a daily routine in words", () => {
  const daily = (weekdays: number[] | null) => ({
    kind: "daily" as const,
    dailyAt: "08:44",
    weekdays,
  });
  expect(describeSchedule(daily(null), "America/Sao_Paulo")).toBe(
    "every day at 08:44 (America/Sao_Paulo)",
  );
  expect(describeSchedule(daily([1, 2, 3, 4, 5]), "UTC")).toBe("weekdays at 08:44 (UTC)");
  expect(describeSchedule(daily([1]), "UTC")).toBe("Mondays at 08:44 (UTC)");
  expect(describeSchedule(daily([0, 6]), "UTC")).toBe("weekends at 08:44 (UTC)");
  expect(describeSchedule(daily([5, 1, 3]), "UTC")).toBe("Mon, Wed, Fri at 08:44 (UTC)");
});

test("an interval and a schedule Zetta cannot run in words", () => {
  expect(describeSchedule({ kind: "interval", everyMinutes: 15 }, "UTC")).toBe("every 15 minutes");
  expect(describeSchedule({ kind: "unsupported", expression: "0 9 1 * *" }, "UTC")).toBe(
    "no schedule Zetta can run yet (0 9 1 * *)",
  );
  expect(describeSchedule({ kind: "unsupported", expression: null }, "UTC")).toBe(
    "no schedule we could read",
  );
});
