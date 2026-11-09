import { describe, expect, test } from "bun:test";
import { schemaProblem, validate } from "./schema";

const obj = (properties: Record<string, unknown>, required: string[] = [], extra: object = {}) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  ...extra,
});
const ok = (schema: Record<string, unknown>, v: unknown) => {
  const r = validate(schema, v);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const bad = (schema: Record<string, unknown>, v: unknown) => {
  const r = validate(schema, v);
  if (r.ok) throw new Error("expected a problem");
  return r.error;
};

describe("validate", () => {
  test("types, with integer as a kind of number", () => {
    expect(ok({ type: "string" }, "a")).toBe("a");
    expect(bad({ type: "string" }, 3)).toBe("input must be string.");
    expect(ok({ type: "integer" }, 3)).toBe(3);
    expect(bad({ type: "integer" }, 3.5)).toContain("must be integer");
    expect(ok({ type: "number" }, 3.5)).toBe(3.5);
    expect(ok({ type: ["string", "null"] }, null)).toBe(null);
    expect(bad({ type: "boolean" }, "true")).toContain("boolean");
  });

  test("limits on strings, numbers and arrays", () => {
    expect(bad({ type: "string", minLength: 2 }, "a")).toContain("at least 2");
    expect(bad({ type: "string", maxLength: 2 }, "abc")).toContain("at most 2");
    expect(bad({ type: "number", minimum: 1 }, 0)).toContain("at least 1");
    expect(bad({ type: "number", maximum: 1 }, 2)).toContain("at most 1");
    expect(bad({ type: "array", minItems: 1 }, [])).toContain("at least 1");
    expect(bad({ type: "array", maxItems: 1 }, [1, 2])).toContain("at most 1");
    expect(bad({ type: "array", items: { type: "string" } }, ["a", 2])).toBe(
      "input[1] must be string.",
    );
  });

  test("enum compares whole JSON values", () => {
    expect(ok({ enum: ["open", "closed"] }, "open")).toBe("open");
    expect(bad({ enum: ["open", "closed"] }, "merged")).toContain('"open", "closed"');
    expect(ok({ enum: [{ a: 1 }] }, { a: 1 })).toEqual({ a: 1 });
  });

  test("an object fills defaults, requires what is required and drops what is not declared", () => {
    const s = obj(
      {
        name: { type: "string" },
        state: { type: "string", default: "open" },
        n: { type: "integer" },
      },
      ["name"],
    );
    expect(ok(s, { name: "x", extra: 1 })).toEqual({ name: "x", state: "open" });
    expect(ok(s, { name: "x", n: 2, state: "closed" })).toEqual({
      name: "x",
      state: "closed",
      n: 2,
    });
    expect(bad(s, {})).toBe("input.name is required.");
    expect(bad(s, { name: 5 })).toBe("input.name must be string.");
    expect(bad(s, [])).toContain("must be object");
  });

  test("nested paths name the field", () => {
    const s = obj({ repo: obj({ owner: { type: "string" } }, ["owner"]) }, ["repo"]);
    expect(bad(s, { repo: { owner: 1 } })).toBe("input.repo.owner must be string.");
    expect(bad(s, { repo: {} })).toBe("input.repo.owner is required.");
  });

  test("additionalProperties: true keeps the rest", () => {
    expect(
      ok(obj({ a: { type: "string" } }, [], { additionalProperties: true }), { a: "x", b: 2 }),
    ).toEqual({ a: "x", b: 2 });
  });

  test("an empty schema takes any JSON and the result is a copy", () => {
    const input = { a: [1, { b: 2 }] };
    const out = ok({}, input) as typeof input;
    expect(out).toEqual(input);
    out.a.push(3);
    expect(input.a).toHaveLength(2);
  });

  test("a default of a missing top-level value is used; a missing value without one is required", () => {
    expect(ok({ type: "string", default: "x" }, undefined)).toBe("x");
    expect(bad({ type: "string" }, undefined)).toBe("input is required.");
  });

  test("huge arrays and deep nesting are refused", () => {
    expect(
      bad(
        { type: "array" },
        Array.from({ length: 1001 }, () => 0),
      ),
    ).toContain("more than 1000");
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = { a: deep };
    let schema: Record<string, unknown> = { type: "number" };
    for (let i = 0; i < 20; i++) schema = obj({ a: schema }, ["a"]);
    expect(bad(schema, deep)).toContain("nested too deeply");
  });

  test("NaN and Infinity are not numbers", () => {
    expect(bad({ type: "number" }, Number.NaN)).toContain("finite");
  });
});

describe("schemaProblem", () => {
  test("accepts what the SDK writes", () => {
    expect(
      schemaProblem(
        obj(
          {
            a: { type: "string", description: "x", default: "y" },
            b: { type: "array", items: { type: "integer" } },
          },
          ["b"],
        ),
      ),
    ).toBeNull();
    expect(schemaProblem({})).toBeNull();
  });
  test("refuses keywords the validator does not know, so a tool never claims a check that is not made", () => {
    expect(schemaProblem({ type: "string", pattern: "^a" })).toContain('"pattern"');
    expect(schemaProblem({ anyOf: [{ type: "string" }] })).toContain('"anyOf"');
    expect(schemaProblem({ $ref: "#/x" })).toContain('"$ref"');
    expect(schemaProblem(obj({ a: { type: "string", format: "email" } }))).toContain('"format"');
  });
  test("refuses odd shapes", () => {
    expect(schemaProblem("string")).toContain("must be an object");
    expect(schemaProblem({ type: "date" })).toContain("not supported");
    expect(schemaProblem({ type: "string", minLength: -1 })).toContain("whole number");
    expect(schemaProblem({ enum: [] })).toContain("1 to 200");
    expect(schemaProblem({ additionalProperties: {} })).toContain("true or false");
    expect(schemaProblem({ type: "string", description: "x".repeat(21_000) })).toContain(
      "larger than",
    );
  });
  test("refuses nesting that the validator would refuse", () => {
    let schema: Record<string, unknown> = { type: "number" };
    for (let i = 0; i < 12; i++) schema = obj({ a: schema }, ["a"]);
    expect(schemaProblem(schema)).toContain("nested too deeply");
  });
});
