import type { InputSpec } from "./playground-api";

/** What a field of the inputs form holds: text for string, number and JSON, a switch for boolean. */
export type FieldValue = string | boolean;

/** The value of an input as the form shows it. */
export function showValue(spec: InputSpec, value: unknown): FieldValue {
  if (spec.type === "boolean") return value === true;
  if (value === undefined || value === null) return "";
  return spec.type === "json" ? JSON.stringify(value) : String(value);
}

/** The value a field holds, as the playground gets it. An empty number or JSON field is no value. Throws a sentence for the person. */
export function readValue(spec: InputSpec, field: FieldValue): unknown {
  if (spec.type === "boolean") return field === true;
  const text = String(field);
  if (spec.type === "string") return text;
  if (text.trim() === "") return undefined;
  if (spec.type === "number") {
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`Input "${spec.name}" must be a number.`);
    return n;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Input "${spec.name}" must be valid JSON.`);
  }
}

/** The values of a run: every field of the form, read by its type. */
export function collectInputs(
  specs: readonly InputSpec[],
  fields: Record<string, FieldValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    const v = readValue(spec, fields[spec.name] ?? showValue(spec, spec.default));
    if (v !== undefined) out[spec.name] = v;
  }
  return out;
}

/** The inputs to save: each one keeps the value on screen as its default. */
export const withDefaults = (specs: readonly InputSpec[], fields: Record<string, FieldValue>) => {
  const values = collectInputs(specs, fields);
  return specs.map(({ default: _old, ...spec }) =>
    spec.name in values ? { ...spec, default: values[spec.name] } : spec,
  );
};
