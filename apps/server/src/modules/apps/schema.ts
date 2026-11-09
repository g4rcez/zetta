import type { AppJsonSchema } from "@zetta/db/schema/apps";

/**
 * The JSON Schema subset that app tools use for their input and output (what the SDK in `sdk.ts` writes). The server checks a call's input
 * against it BEFORE anything runs (so a card never shows an input the tool would refuse, and defaults are filled in), and the output after.
 * Supported: type (string, number, integer, boolean, null, array, object, or a list for "nullable"), enum, default, description,
 * minLength/maxLength, minimum/maximum, items/minItems/maxItems, properties/required/additionalProperties. An empty schema `{}` accepts any JSON.
 */
export type Checked = { ok: true; value: unknown } | { ok: false; error: string };

const TYPES = new Set(["string", "number", "integer", "boolean", "null", "array", "object"]);
const KEYWORDS = new Set([
  "type",
  "enum",
  "default",
  "description",
  "title",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "items",
  "minItems",
  "maxItems",
  "properties",
  "required",
  "additionalProperties",
]);
const MAX_DEPTH = 8;
const MAX_ARRAY = 1000;
const MAX_PROPERTIES = 100;
export const MAX_SCHEMA_BYTES = 20_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Null when `schema` only uses what the validator understands; else why not. Run when an app is published. */
export function schemaProblem(schema: unknown, path = "schema", depth = 0): string | null {
  if (!isRecord(schema)) return `${path} must be an object.`;
  if (depth === 0 && JSON.stringify(schema).length > MAX_SCHEMA_BYTES)
    return `${path} is larger than ${MAX_SCHEMA_BYTES} characters.`;
  if (depth > MAX_DEPTH) return `${path} is nested too deeply.`;
  for (const k of Object.keys(schema))
    if (!KEYWORDS.has(k)) return `${path} uses "${k}", which is not supported.`;
  const types =
    schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  for (const t of types)
    if (typeof t !== "string" || !TYPES.has(t))
      return `${path}.type "${String(t)}" is not supported.`;
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 200)
  )
    return `${path}.enum must be a list of 1 to 200 values.`;
  for (const k of ["minLength", "maxLength", "minItems", "maxItems"] as const)
    if (schema[k] !== undefined && (!Number.isInteger(schema[k]) || (schema[k] as number) < 0))
      return `${path}.${k} must be a whole number.`;
  for (const k of ["minimum", "maximum"] as const)
    if (
      schema[k] !== undefined &&
      (typeof schema[k] !== "number" || !Number.isFinite(schema[k] as number))
    )
      return `${path}.${k} must be a number.`;
  if (schema.items !== undefined) {
    const p = schemaProblem(schema.items, `${path}.items`, depth + 1);
    if (p) return p;
  }
  if (schema.properties !== undefined) {
    if (!isRecord(schema.properties)) return `${path}.properties must be an object.`;
    const keys = Object.keys(schema.properties);
    if (keys.length > MAX_PROPERTIES) return `${path} has more than ${MAX_PROPERTIES} properties.`;
    for (const k of keys) {
      const p = schemaProblem(schema.properties[k], `${path}.${k}`, depth + 1);
      if (p) return p;
    }
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || schema.required.some((r) => typeof r !== "string"))
  )
    return `${path}.required must be a list of names.`;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean")
    return `${path}.additionalProperties must be true or false.`;
  return null;
}

const typeName = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function walk(schema: AppJsonSchema, value: unknown, path: string, depth: number): Checked {
  const fail = (error: string): Checked => ({ ok: false, error });
  if (depth > MAX_DEPTH + 2) return fail(`${path} is nested too deeply.`);
  if (value === undefined) {
    if (schema.default !== undefined) return walk(schema, clone(schema.default), path, depth);
    return fail(`${path} is required.`);
  }
  const types =
    schema.type === undefined
      ? []
      : ((Array.isArray(schema.type) ? schema.type : [schema.type]) as string[]);
  if (types.length) {
    const actual = typeName(value);
    const okType = types.some(
      (t) => t === actual || (t === "integer" && actual === "number" && Number.isInteger(value)),
    );
    if (!okType) return fail(`${path} must be ${types.join(" or ")}.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => sameJson(e, value)))
    return fail(`${path} must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}.`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      return fail(`${path} must have at least ${schema.minLength} characters.`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      return fail(`${path} must have at most ${schema.maxLength} characters.`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail(`${path} must be a finite number.`);
    if (typeof schema.minimum === "number" && value < schema.minimum)
      return fail(`${path} must be at least ${schema.minimum}.`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      return fail(`${path} must be at most ${schema.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return fail(`${path} has more than ${MAX_ARRAY} items.`);
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      return fail(`${path} needs at least ${schema.minItems} items.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      return fail(`${path} allows at most ${schema.maxItems} items.`);
    if (isRecord(schema.items)) {
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = walk(schema.items as AppJsonSchema, value[i], `${path}[${i}]`, depth + 1);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    return { ok: true, value: clone(value) };
  }
  if (isRecord(value) && (schema.properties !== undefined || types.includes("object"))) {
    const props = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const out: Record<string, unknown> = {};
    for (const [k, sub] of Object.entries(props)) {
      const present = Object.hasOwn(value, k) && value[k] !== undefined;
      if (!present && !required.has(k) && (sub as AppJsonSchema).default === undefined) continue;
      const r = walk(
        sub as AppJsonSchema,
        present ? value[k] : undefined,
        `${path}.${k}`,
        depth + 1,
      );
      if (!r.ok) return r;
      out[k] = r.value;
    }
    // Undeclared properties are dropped, unless the schema says it takes more.
    if (schema.additionalProperties === true)
      for (const [k, v] of Object.entries(value)) if (!(k in props)) out[k] = clone(v);
    return { ok: true, value: out };
  }
  return { ok: true, value: clone(value) };
}

/** The value as the tool will see it: defaults filled in, undeclared properties dropped. Or the first problem, worded for a person. */
export function validate(schema: AppJsonSchema, value: unknown, name = "input"): Checked {
  return walk(schema, value, name, 0);
}
