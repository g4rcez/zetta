import { z } from "zod";

import { catalog } from "./catalog";
import { UI_FENCE } from "./reply";

type Def = { props: z.ZodType; description?: string; slots?: string[] };

/** `{ title?: string, level?: "1" | "2" }`: the same shape the json-render prompt prints, built from the catalog's zod schemas. */
function signature(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, unknown>; required?: string[] };
  const type = (p: any): string => p.enum ? p.enum.map((v: unknown) => JSON.stringify(v)).join("|")
    : p.type === "array" ? `${type(p.items ?? {})}[]`
    : p.type === "object" ? `{ ${Object.entries<any>(p.properties ?? {}).map(([k, v]) => `${k}${p.required?.includes(k) ? "" : "?"}: ${type(v)}`).join(", ")} }`
    : p.anyOf ? p.anyOf.map(type).filter((t: string) => t !== "null").join("|")
    : Array.isArray(p.type) ? p.type.filter((t: string) => t !== "null").join("|")
    : p.type ?? "any";
  const fields = Object.entries<any>(json.properties ?? {}).map(([k, v]) => `${k}${json.required?.includes(k) ? "" : "?"}: ${type(v)}`);
  return fields.length ? `{ ${fields.join(", ")} }` : "{}";
}

/**
 * Instructions that teach a bot to draw rich answers. Generated from the catalog, so the prompt, the validation and the web
 * registry can never drift apart. Much smaller than `catalog.prompt()`, which also documents state, repeat and actions
 * this display-only catalog does not have.
 */
export function uiPrompt(): string {
  const list = Object.entries(catalog.data.components as Record<string, Def>).map(([name, def]) => `- ${name} ${signature(def.props)}${def.slots?.length ? " [children]" : ""}: ${def.description ?? ""}`).join("\n");
  return `Rich answers: when a structured view reads better than prose (a comparison, a status summary, numbers, a table), draw it by writing a fenced block named ${UI_FENCE} whose lines are JSON patches that build a flat element tree. Keep writing normal markdown around it; use plain text when prose is enough.
\`\`\`${UI_FENCE}
{"op":"add","path":"/root","value":"main"}
{"op":"add","path":"/elements/main","value":{"type":"Card","props":{"title":"Deploy status"},"children":["env","ok"]}}
{"op":"add","path":"/elements/env","value":{"type":"KeyValue","props":{"items":[{"label":"Environment","value":"production"},{"label":"Version","value":"1.4.2"}]}}}
{"op":"add","path":"/elements/ok","value":{"type":"Badge","props":{"label":"Healthy","tone":"success"}}}
\`\`\`
Rules: one JSON object per line, first /root, then one /elements/<key> line per element, parents before children; "children" lists element keys; leave out props you do not need; every value is plain text (no markdown or HTML); no state, actions or expressions. Only these components exist, anything else is dropped:
${list}`;
}
