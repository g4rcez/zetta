import { describe, expect, test } from "bun:test";
import type { AppApproval, AppToolKind, AppToolPolicy } from "@zetta/db/schema/apps";
import { approvalProblem, at, conditionHolds, decide, describePolicy } from "./policy";

const run = (
  kind: AppToolKind,
  approval?: AppApproval,
  override?: AppToolPolicy,
  input: unknown = {},
  outside = false,
) => decide({ kind, approval, override, input, outside }).decision;

describe("decide: defaults by kind", () => {
  test("a query runs and a mutation asks", () => {
    expect(run("query")).toBe("run");
    expect(run("mutation")).toBe("ask");
  });
});

describe("decide: what the tool declares", () => {
  test("never lets even a mutation run; always makes even a query ask", () => {
    expect(run("mutation", "never")).toBe("run");
    expect(run("query", "always")).toBe("ask");
  });
  test("when asks only if every condition holds", () => {
    const a: AppApproval = {
      when: [
        { path: "repo.private", op: "eq", value: true },
        { path: "count", op: "gt", value: 10 },
      ],
    };
    expect(run("mutation", a, undefined, { repo: { private: true }, count: 11 })).toBe("ask");
    expect(run("mutation", a, undefined, { repo: { private: true }, count: 3 })).toBe("run");
    expect(run("mutation", a, undefined, { repo: { private: false }, count: 99 })).toBe("run");
  });
});

describe("decide: the owner's choice beats the code", () => {
  test("block denies whatever the tool says", () => {
    expect(run("query", "never", "block")).toBe("deny");
    expect(run("mutation", "never", "block")).toBe("deny");
  });
  test("ask asks even when the tool says never", () => {
    expect(run("mutation", "never", "ask")).toBe("ask");
    expect(run("query", undefined, "ask")).toBe("ask");
  });
  test("auto runs even a mutation that says always", () => {
    expect(run("mutation", "always", "auto")).toBe("run");
  });
});

describe("decide: outside people", () => {
  test("only a query that needs no answer runs", () => {
    expect(run("query", undefined, undefined, {}, true)).toBe("run");
    expect(run("query", "always", undefined, {}, true)).toBe("deny");
    expect(run("query", undefined, "ask", {}, true)).toBe("deny");
    expect(run("query", undefined, "block", {}, true)).toBe("deny");
  });
  test("a mutation is denied, even when the owner set it to auto", () => {
    expect(run("mutation", "never", undefined, {}, true)).toBe("deny");
    expect(run("mutation", undefined, "auto", {}, true)).toBe("deny");
  });
});

describe("conditions", () => {
  test("paths read objects and arrays", () => {
    expect(at({ a: { b: [1, { c: 3 }] } }, "a.b.1.c")).toBe(3);
    expect(at({ a: 1 }, "a.b")).toBeUndefined();
    expect(at(null, "a")).toBeUndefined();
    expect(at({ a: 1 }, "__proto__")).toBeUndefined();
  });
  test("every operator", () => {
    const input = { n: 5, s: "hello world", tags: ["x", { y: 1 }], z: null };
    const holds = (path: string, op: string, value?: unknown) =>
      conditionHolds({ path, op: op as never, value }, input);
    expect(holds("n", "eq", 5)).toBe(true);
    expect(holds("n", "neq", 5)).toBe(false);
    expect(holds("n", "gt", 4)).toBe(true);
    expect(holds("n", "lt", 4)).toBe(false);
    expect(holds("s", "contains", "world")).toBe(true);
    expect(holds("tags", "contains", { y: 1 })).toBe(true);
    expect(holds("tags", "contains", "q")).toBe(false);
    expect(holds("n", "contains", 5)).toBe(false);
    expect(holds("s", "exists")).toBe(true);
    expect(holds("z", "exists")).toBe(false);
    expect(holds("nope", "exists")).toBe(false);
    expect(holds("s", "gt", 1)).toBe(false);
  });
});

describe("approvalProblem", () => {
  test("accepts the three forms", () => {
    expect(approvalProblem(undefined)).toBeNull();
    expect(approvalProblem("always")).toBeNull();
    expect(approvalProblem("never")).toBeNull();
    expect(approvalProblem({ when: [{ path: "a.b", op: "eq", value: 1 }] })).toBeNull();
  });
  test("refuses anything else", () => {
    expect(approvalProblem("sometimes")).toContain("must be");
    expect(approvalProblem({ when: [] })).toContain("must be");
    expect(approvalProblem({ when: [{ path: "a b", op: "eq" }] })).toContain("path");
    expect(approvalProblem({ when: [{ path: "a", op: "regex" }] })).toContain("operator");
    expect(
      approvalProblem({ when: Array.from({ length: 11 }, () => ({ path: "a", op: "exists" })) }),
    ).toContain("must be");
  });
});

describe("describePolicy", () => {
  test("says who wins", () => {
    expect(describePolicy("query")).toBe("Never asks (reads)");
    expect(describePolicy("mutation")).toBe("Asks (changes something)");
    expect(describePolicy("mutation", "never")).toBe("Never asks");
    expect(describePolicy("mutation", "never", "block")).toBe("Blocked");
    expect(describePolicy("query", { when: [{ path: "a", op: "exists" }] })).toBe(
      "Asks for some inputs",
    );
  });
});
