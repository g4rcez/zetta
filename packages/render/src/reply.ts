import { createSpecStreamCompiler } from "@json-render/core";

import { catalog, type ComponentName } from "./catalog";

/** A bot draws UI by writing a fenced block named like this; the rest of the reply stays markdown. */
export const UI_FENCE = "zetta:ui";

/** A spec that passed the catalog: every element is a known component with parsed props, and the tree has no cycles or dangling children. */
export type UiElement = { type: ComponentName; props: Record<string, unknown>; children: string[] };
export type UiSpec = { root: string; elements: Record<string, UiElement> };
/**
 * Why part of a block was dropped. Codes and names only, never prop values, so it is safe to log.
 * `path` is the zod path inside the props (for example `chart.series.0.values`).
 */
export type SpecIssue = {
  code:
    | "unparseable"
    | "bad_root"
    | "unknown_type"
    | "invalid_props"
    | "dangling_child"
    | "repeated_child"
    | "too_deep"
    | "too_many";
  element?: string;
  type?: string;
  path?: string;
};
export type ReplySegment =
  | { kind: "markdown"; text: string }
  | { kind: "ui"; spec: UiSpec | null; raw: string; complete: boolean; issues: SpecIssue[] };

const MAX_ELEMENTS = 150;
const MAX_DEPTH = 8;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clip = (v: string) => v.slice(0, 40);
const components = catalog.data.components as Record<
  string,
  {
    props: {
      safeParse: (v: unknown) => {
        success: boolean;
        data?: unknown;
        error?: { issues: { path: PropertyKey[] }[] };
      };
    };
    slots?: string[];
  }
>;

/**
 * Keeps only what the catalog allows. Model output is untrusted: unknown types, invalid props and dangling or repeated
 * child references are dropped (the rest still renders), and everything beyond type/props/children (state, repeat, visible, actions)
 * is discarded so a spec can only ever draw. `issues` says what was dropped and why.
 */
export function inspectSpec(input: unknown): { spec: UiSpec | null; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  if (!isRecord(input) || typeof input.root !== "string" || !isRecord(input.elements))
    return { spec: null, issues: [{ code: "bad_root" }] };
  const raw = input.elements,
    elements: Record<string, UiElement> = {};
  let count = 0;
  const visit = (key: string, depth: number, parent?: string): boolean => {
    const el = raw[key];
    if (key in elements) {
      issues.push({ code: "repeated_child", element: clip(key) });
      return false;
    }
    if (count >= MAX_ELEMENTS) {
      issues.push({ code: "too_many", element: clip(key) });
      return false;
    }
    if (depth > MAX_DEPTH) {
      issues.push({ code: "too_deep", element: clip(key) });
      return false;
    }
    if (!isRecord(el) || typeof el.type !== "string") {
      issues.push({
        code: parent === undefined ? "bad_root" : "dangling_child",
        element: clip(key),
      });
      return false;
    }
    const def = components[el.type];
    if (!def) {
      issues.push({ code: "unknown_type", element: clip(key), type: clip(el.type) });
      return false;
    }
    const props = def.props.safeParse(isRecord(el.props) ? el.props : {});
    if (!props.success) {
      for (const path of new Set(
        (props.error?.issues ?? []).slice(0, 3).map((i) => i.path.map(String).join(".")),
      ))
        issues.push({
          code: "invalid_props",
          element: clip(key),
          type: el.type,
          path: path.slice(0, 80),
        });
      return false;
    }
    const out: UiElement = {
      type: el.type as ComponentName,
      props: props.data as Record<string, unknown>,
      children: [],
    };
    elements[key] = out;
    count++;
    if (def.slots?.length && Array.isArray(el.children))
      for (const child of el.children)
        if (typeof child === "string" && visit(child, depth + 1, key)) out.children.push(child);
    return true;
  };
  return visit(input.root, 0)
    ? { spec: { root: input.root, elements }, issues }
    : { spec: null, issues };
}

export const sanitizeSpec = (input: unknown): UiSpec | null => inspectSpec(input).spec;

/** Compiles a block body: either one complete JSON spec, or JSONL patches (the streaming form). */
export function inspectUiBody(
  body: string,
  complete: boolean,
): { spec: UiSpec | null; issues: SpecIssue[] } {
  const text = body.trim();
  if (!text) return { spec: null, issues: [{ code: "unparseable" }] };
  try {
    const whole = JSON.parse(text);
    if (isRecord(whole) && "elements" in whole) return inspectSpec(whole);
  } catch {
    /* not a single JSON document: JSONL patches */
  }
  try {
    const compiler = createSpecStreamCompiler<Record<string, unknown>>();
    compiler.push(complete ? `${text}\n` : text);
    return inspectSpec(compiler.getResult());
  } catch {
    return { spec: null, issues: [{ code: "unparseable" }] };
  }
}

export const compileUiBody = (body: string, complete: boolean): UiSpec | null =>
  inspectUiBody(body, complete).spec;

const OPEN = new RegExp(`^\`\`\`${UI_FENCE}\\s*$`),
  CLOSE = /^```\s*$/,
  ANY_FENCE = /^\s*```/;

/**
 * Splits a reply into markdown and `zetta:ui` blocks. While streaming, an unclosed trailing block is returned with
 * `complete: false` so the view can fill in as lines arrive. Ordinary code fences are skipped whole, so a documented example
 * of the block inside one stays code.
 */
export function splitReply(content: string, streaming = false): ReplySegment[] {
  const out: ReplySegment[] = [],
    md: string[] = [];
  const flush = () => {
    const text = md.join("\n");
    md.length = 0;
    if (text.trim()) out.push({ kind: "markdown", text });
  };
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (OPEN.test(line.trim())) {
      let end = i + 1;
      while (end < lines.length && !CLOSE.test(lines[end]!.trim())) end++;
      const complete = end < lines.length || !streaming,
        raw = lines.slice(i + 1, end).join("\n");
      flush();
      out.push({ kind: "ui", raw, complete, ...inspectUiBody(raw, complete) });
      i = end;
    } else if (ANY_FENCE.test(line)) {
      md.push(line);
      for (i++; i < lines.length; i++) {
        md.push(lines[i]!);
        if (CLOSE.test(lines[i]!.trim())) break;
      }
    } else md.push(line);
  }
  flush();
  return out;
}
