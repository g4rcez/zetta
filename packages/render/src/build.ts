import { z } from "zod";

import { catalog, type ComponentName } from "./catalog";
import { inspectSpec, UI_FENCE } from "./reply";

type Components = typeof catalog.data.components;
type PropsOf<K extends ComponentName> = z.input<Components[K]["props"]>;

/** One element of a view the server draws itself: a catalog component with its props and nested children. */
export type El = {
  [K in ComponentName]: { type: K; props: PropsOf<K>; children?: El[] };
}[ComponentName];

type Json = {
  type?: string | string[];
  maxLength?: number;
  maxItems?: number;
  items?: Json;
  properties?: Record<string, Json>;
  anyOf?: Json[];
};
const schemas = new Map<string, Json>();
const schemaOf = (type: string): Json => {
  let json = schemas.get(type);
  if (!json) {
    const def = (catalog.data.components as Record<string, { props: z.ZodType }>)[type]!;
    json = z.toJSONSchema(def.props, { io: "input", unrepresentable: "any" }) as Json;
    schemas.set(type, json);
  }
  return json;
};

const kind = (v: unknown) =>
  Array.isArray(v) ? "array" : v === null ? "null" : typeof v === "number" ? "number" : typeof v;
const isType = (j: Json, k: string) =>
  Array.isArray(j.type)
    ? j.type.includes(k)
    : j.type === k || (k === "number" && j.type === "integer");

/** Cuts text and lists down to the limits the catalog's own schema declares, so a long name or a huge list can never make the block invalid. */
function clipTo(json: Json | undefined, value: unknown): unknown {
  if (!json) return value;
  if (json.anyOf) {
    const k = kind(value);
    const branches = json.anyOf.filter((b) => isType(b, k));
    const branch =
      k === "object"
        ? branches.find((b) =>
            Object.keys(value as object).every((key) => b.properties && key in b.properties),
          )
        : branches[0];
    return branch ? clipTo(branch, value) : value;
  }
  if (typeof value === "string") return json.maxLength ? value.slice(0, json.maxLength) : value;
  if (Array.isArray(value))
    return (json.maxItems ? value.slice(0, json.maxItems) : value).map((item) =>
      clipTo(json.items, item),
    );
  if (value && typeof value === "object" && json.properties) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clipTo(json.properties![k], v)]),
    );
  }
  return value;
}

/**
 * A `zetta:ui` block written by the server (never the model), so it is typed against the catalog and cannot drift from it.
 * Keys are assigned, text and lists are clipped to the catalog limits, and the result goes through the same `sanitizeSpec` the
 * web uses. Backticks in values become quotes so nothing can close the fence. Throws when the tree is not a valid view
 * (a programming error: wrong enum value, empty list), so a test catches it before a user does.
 */
export function uiBlock(root: El): string {
  const elements: Record<string, { type: string; props: unknown; children: string[] }> = {};
  let n = 0;
  const add = (el: El): string => {
    const key = `e${n++}`;
    const children = (el.children ?? []).map(add);
    elements[key] = { type: el.type, props: clipTo(schemaOf(el.type), el.props), children };
    return key;
  };
  const rootKey = add(root);
  const spec = { root: rootKey, elements };
  const { spec: checked, issues } = inspectSpec(spec);
  if (!checked || issues.length)
    throw new Error(
      `uiBlock: the ${root.type} view does not match the catalog (${issues.map((i) => [i.code, i.type, i.path].filter(Boolean).join(" ")).join("; ")})`,
    );
  return `\`\`\`${UI_FENCE}\n${JSON.stringify(spec).replace(/`/g, "'")}\n\`\`\``;
}
