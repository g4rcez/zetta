import { describe, expect, test } from "bun:test";
import {
  applyProjectFilters,
  parseProjectSearch,
  projectLabels,
  toProjectSearch,
  toProjectState,
} from "./project-filters";
import type { Project } from "./projects-api";

const project = (over: Partial<Project>): Project => ({
  id: over.name ?? "p",
  name: "P",
  outcome: "",
  audience: "",
  doneWhen: "",
  notIncluded: "",
  labels: [],
  status: "active",
  watch: "normal",
  role: "owner",
  bots: [],
  people: [],
  counts: { backlog: 0, in_progress: 0, blocked: 0, review: 0, done: 0, total: 0 },
  health: { state: "on_track", sentence: "" },
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("project filters", () => {
  test("the address keeps only what is understood, without defaults", () => {
    expect(parseProjectSearch({})).toEqual({});
    expect(parseProjectSearch({ show: "current", query: "  ", label: "" })).toEqual({});
    expect(parseProjectSearch({ show: "archived", query: " Launch ", label: "Q2" })).toEqual({
      show: "archived",
      query: "Launch",
      label: "q2",
    });
    expect(parseProjectSearch({ show: "weird", query: 3, label: ["x"] })).toEqual({});
  });
  test("state and address round-trip", () => {
    const state = toProjectState({ show: "all", query: "x" });
    expect(state).toEqual({ show: "all", query: "x", label: "" });
    expect(toProjectSearch(state)).toEqual({ show: "all", query: "x" });
    expect(toProjectSearch(toProjectState({}))).toEqual({});
  });
  test("the default shows what is still going, with what needs the reader first", () => {
    const all = [
      project({ name: "Old", status: "archived", health: { state: "done", sentence: "" } }),
      project({ name: "Fine", updatedAt: "2026-11-05T00:00:00Z" }),
      project({ name: "Hold", status: "paused", health: { state: "on_hold", sentence: "" } }),
      project({ name: "Me", health: { state: "needs_you", sentence: "" } }),
      project({ name: "Finer", updatedAt: "2026-11-09T00:00:00Z" }),
      project({ name: "Shipped", status: "done", health: { state: "done", sentence: "" } }),
    ];
    const names = (show: Parameters<typeof toProjectState>[0]) =>
      applyProjectFilters(all, toProjectState(show)).map((p) => p.name);
    expect(names({})).toEqual(["Me", "Finer", "Fine", "Hold"]);
    expect(names({ show: "archived" })).toEqual(["Old"]);
    expect(names({ show: "all" })).toHaveLength(6);
  });
  test("search reads the name, the outcome and the labels; a label narrows", () => {
    const all = [
      project({ name: "Spring launch", labels: ["q2"] }),
      project({ name: "Hiring", outcome: "Two launch engineers" }),
      project({ name: "Budget", labels: ["finance", "q2"] }),
    ];
    const names = (s: Parameters<typeof toProjectState>[0]) =>
      applyProjectFilters(all, toProjectState(s))
        .map((p) => p.name)
        .sort();
    expect(names({ query: "LAUNCH" })).toEqual(["Hiring", "Spring launch"]);
    expect(names({ query: "fin" })).toEqual(["Budget"]);
    expect(names({ label: "q2" })).toEqual(["Budget", "Spring launch"]);
    expect(projectLabels(all)).toEqual(["finance", "q2"]);
  });
});
