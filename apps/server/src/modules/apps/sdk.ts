import type { PlaygroundFileSnapshot } from "@zetta/db/schema/playground";

/**
 * The SDK an app imports as `zetta-app`, and the harness that runs it. Both are plain JavaScript kept as text, because the server is
 * bundled for production and cannot read loose files at run time. They are written into the run folder next to the app's own files.
 *
 * An app looks like this:
 *
 *   import { defineApp, query, mutation, t } from "zetta-app";
 *   export default defineApp({
 *     tools: {
 *       issues: {
 *         list: query({ description: "...", input: t.object({ repo: t.string() }) }, async (ctx, input) => [...]),
 *       },
 *     },
 *   });
 *
 * The harness reads one JSON payload from standard input (`{mode:"describe"}` or `{mode:"call", tool, input, accounts}`) and writes
 * `result.json`. Validation of input and output is the server's job (modules/apps/schema.ts), not the SDK's: the SDK only describes.
 * No template literals or `${` below: this is a template literal itself.
 */
export const SDK_VERSION = 1;
export const SDK_DIR = "node_modules/zetta-app";
export const HARNESS_FILE = "__zetta_run.ts";
export const RESULT_FILE = "result.json";

const SDK_JS = String.raw`
const strip = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};
function make(schema, isOptional) {
  return {
    schema,
    isOptional,
    optional: () => make(schema, true),
    default: (value) => make({ ...schema, default: value }, true),
    describe: (description) => make({ ...schema, description }, isOptional),
  };
}
export const t = {
  string: (o = {}) => make(strip({ type: "string", minLength: o.min, maxLength: o.max, enum: o.oneOf }), false),
  number: (o = {}) => make(strip({ type: "number", minimum: o.min, maximum: o.max }), false),
  integer: (o = {}) => make(strip({ type: "integer", minimum: o.min, maximum: o.max }), false),
  boolean: () => make({ type: "boolean" }, false),
  json: () => make({}, false),
  array: (item, o = {}) => make(strip({ type: "array", items: item.schema, minItems: o.min, maxItems: o.max }), false),
  object: (shape = {}, o = {}) => {
    const properties = {};
    const required = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = v.schema;
      if (!v.isOptional) required.push(k);
    }
    return make(strip({ type: "object", properties, required: required.length ? required : undefined, additionalProperties: o.extra === true }), false);
  },
};
const tool = (kind) => (opts, handler) => {
  if (typeof handler !== "function") throw new Error("a tool needs a handler function");
  return { __tool: true, kind, opts: opts || {}, handler };
};
export const query = tool("query");
export const mutation = tool("mutation");
export const account = {
  apiKey: (o = {}) => ({ auth: "api_key", scope: o.scope === "app" ? "app" : "user", label: o.label, fields: o.fields }),
};
export function defineApp(def = {}) {
  const tools = {};
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const name = prefix ? prefix + "." + k : k;
      if (v && v.__tool) tools[name] = v;
      else if (v && typeof v === "object") walk(v, name);
      else throw new Error("tools." + name + " is not a tool");
    }
  };
  walk(def.tools, "");
  return { __zetta: 1, accounts: def.accounts || {}, tools };
}
function manifestOf(app) {
  return {
    sdk: 1,
    accounts: Object.fromEntries(
      Object.entries(app.accounts).map(([name, a]) => [name, strip({ label: a.label || name, scope: a.scope, auth: a.auth, fields: a.fields })]),
    ),
    tools: Object.entries(app.tools).map(([name, tl]) =>
      strip({
        name,
        kind: tl.kind,
        description: tl.opts.description || "",
        input: (tl.opts.input || t.object({})).schema,
        output: tl.opts.output ? tl.opts.output.schema : undefined,
        approval: tl.opts.approval,
        accounts: tl.opts.accounts || [],
        storage: tl.opts.storage,
      }),
    ),
  };
}
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function storageOf(tl, snapshot, ops) {
  const decl = tl.opts.storage || {};
  const declared = new Set([...(decl.collections || []), ...(decl.shared || [])]);
  // The tool sees the records the server sent, and its own writes on top of them.
  const view = {};
  for (const c of declared) view[c] = new Map(Object.entries(snapshot[c] || {}));
  const known = (c) => {
    if (!declared.has(c)) throw Object.assign(new Error("This tool did not declare the collection " + String(c) + " in storage."), { code: "STORAGE_UNDECLARED" });
    return view[c];
  };
  const canWrite = () => {
    if (tl.kind !== "mutation" || decl.write !== true) throw Object.assign(new Error("This tool cannot write storage. Declare storage: { write: true } on a mutation."), { code: "STORAGE_READONLY" });
  };
  return {
    get: (c, key) => (known(c).has(key) ? clone(known(c).get(key)) : undefined),
    list: (c, o = {}) => {
      const out = [];
      for (const [key, value] of known(c)) if (!o.prefix || key.startsWith(o.prefix)) out.push({ key, value: clone(value) });
      out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return o.limit ? out.slice(0, o.limit) : out;
    },
    put: (c, key, value) => {
      const m = known(c);
      canWrite();
      const v = clone(value);
      m.set(key, v);
      ops.push({ op: "put", collection: c, key, value: v });
    },
    delete: (c, key) => {
      const m = known(c);
      canWrite();
      m.delete(key);
      ops.push({ op: "delete", collection: c, key });
    },
  };
}
export async function __run(app) {
  const write = (obj) => Bun.write("result.json", JSON.stringify(obj));
  if (!app || app.__zetta !== 1) {
    await write({ ok: false, error: { code: "NOT_AN_APP", message: "The entry file must export default defineApp({ ... })." } });
    return;
  }
  const raw = await Bun.stdin.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (payload.mode === "describe") {
    await write(manifestOf(app));
    return;
  }
  const tl = app.tools[payload.tool];
  if (!tl) {
    await write({ ok: false, error: { code: "UNKNOWN_TOOL", message: "This app has no tool " + String(payload.tool) + "." } });
    return;
  }
  const ops = [];
  const ctx = { accounts: payload.accounts || {}, log: (...args) => console.error(...args), storage: storageOf(tl, payload.storage || {}, ops) };
  try {
    const value = await tl.handler(ctx, payload.input === undefined ? {} : payload.input);
    await write({ ok: true, value: value === undefined ? null : value, storage: ops.length ? ops : undefined });
  } catch (e) {
    await write({ ok: false, error: { code: (e && e.code) || "TOOL_ERROR", message: String((e && e.message) || e).slice(0, 1000) } });
  }
}
`;

const SDK_PACKAGE = JSON.stringify({
  name: "zetta-app",
  version: "1.0.0",
  type: "module",
  main: "index.js",
  exports: "./index.js",
});

/** The files the harness needs in the run folder, next to the app's own. `entry` is the app's entry file (for example `index.ts`). */
export function sdkFiles(entry: string): PlaygroundFileSnapshot[] {
  const target = entry.startsWith("./") ? entry : `./${entry}`;
  return [
    { path: `${SDK_DIR}/package.json`, content: SDK_PACKAGE },
    { path: `${SDK_DIR}/index.js`, content: SDK_JS },
    {
      path: HARNESS_FILE,
      content: `import app from ${JSON.stringify(target)};\nimport { __run } from "zetta-app";\nawait __run(app);\n`,
    },
  ];
}

/** True when an app's own file would overwrite part of the SDK or the harness. */
export const clashesWithSdk = (path: string) =>
  path === HARNESS_FILE ||
  path === RESULT_FILE ||
  path === SDK_DIR ||
  path.startsWith(`${SDK_DIR}/`);
