import { isRecord } from "@zetta/core/is-record";
import type { AppAccountManifest, AppManifest, AppToolManifest } from "@zetta/db/schema/apps";
import { approvalProblem } from "./policy";
import { schemaProblem } from "./schema";
import { SDK_VERSION } from "./sdk";

/** Limits on what an app may declare. */
export const MANIFEST_LIMITS = {
  tools: 100,
  accounts: 10,
  fields: 10,
  description: 500,
  label: 100,
  /** Collections one tool may name, and the length of a collection name. */
  collections: 10,
} as const;
const TOOL_NAME = /^[a-z][A-Za-z0-9_]{0,39}(\.[a-z][A-Za-z0-9_]{0,39}){0,3}$/;
const ACCOUNT_NAME = /^[a-z][a-z0-9_-]{0,29}$/;
export const COLLECTION_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export class ManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "The app is not valid.");
  }
}

/**
 * Reads what the SDK printed in `describe` mode. Returns the manifest cut down to what Zetta knows (nothing unknown is kept), or throws a
 * ManifestError listing every problem, worded for the person who wrote the app.
 */
export function checkManifest(raw: unknown, page?: { entry: string; bytes: number }): AppManifest {
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);
  if (!isRecord(raw)) throw new ManifestError(["The app did not describe itself."]);
  if (raw.sdk !== SDK_VERSION)
    bad(`The app uses SDK ${String(raw.sdk)}; this server runs SDK ${SDK_VERSION}.`);

  const accounts: Record<string, AppAccountManifest> = {};
  const rawAccounts = isRecord(raw.accounts) ? raw.accounts : {};
  if (Object.keys(rawAccounts).length > MANIFEST_LIMITS.accounts)
    bad(`An app may declare at most ${MANIFEST_LIMITS.accounts} accounts.`);
  for (const [name, a] of Object.entries(rawAccounts)) {
    if (!ACCOUNT_NAME.test(name)) {
      bad(`The account name "${name}" must be lowercase letters, digits, - or _.`);
      continue;
    }
    if (!isRecord(a)) {
      bad(`The account "${name}" is not valid.`);
      continue;
    }
    if (a.auth !== "api_key")
      bad(
        `The account "${name}" uses sign-in "${String(a.auth)}", which is not supported yet. Use account.apiKey(...).`,
      );
    if (a.scope !== "user" && a.scope !== "app")
      bad(`The account "${name}" needs a scope of "user" or "app".`);
    const fields = Array.isArray(a.fields) ? a.fields : [];
    if (fields.length === 0 || fields.length > MANIFEST_LIMITS.fields)
      bad(`The account "${name}" needs 1 to ${MANIFEST_LIMITS.fields} fields.`);
    const seen = new Set<string>();
    const cleanFields = fields.flatMap((f: unknown) => {
      if (!isRecord(f) || typeof f.key !== "string" || !FIELD_KEY.test(f.key) || seen.has(f.key)) {
        bad(`The account "${name}" has a field that is not valid.`);
        return [];
      }
      seen.add(f.key);
      return [
        {
          key: f.key,
          label: String(f.label ?? f.key).slice(0, MANIFEST_LIMITS.label),
          secret: f.secret !== false,
        },
      ];
    });
    accounts[name] = {
      label: String(a.label ?? name).slice(0, MANIFEST_LIMITS.label),
      scope: a.scope === "app" ? "app" : "user",
      auth: "api_key",
      fields: cleanFields,
    };
  }

  const tools: AppToolManifest[] = [];
  const rawTools = Array.isArray(raw.tools) ? raw.tools : [];
  if (rawTools.length === 0 && !page) bad("The app declares no tools.");
  if (rawTools.length > MANIFEST_LIMITS.tools)
    bad(`An app may declare at most ${MANIFEST_LIMITS.tools} tools.`);
  const names = new Set<string>();
  for (const t of rawTools.slice(0, MANIFEST_LIMITS.tools)) {
    if (!isRecord(t) || typeof t.name !== "string" || !TOOL_NAME.test(t.name)) {
      bad(
        `A tool has a name that is not valid (${isRecord(t) ? String(t.name) : "?"}). Use words like issues.list.`,
      );
      continue;
    }
    const name = t.name;
    if (names.has(name)) {
      bad(`The tool "${name}" is declared twice.`);
      continue;
    }
    names.add(name);
    if (t.kind !== "query" && t.kind !== "mutation")
      bad(`The tool "${name}" must be a query or a mutation.`);
    const description = typeof t.description === "string" ? t.description : "";
    if (description.length > MANIFEST_LIMITS.description)
      bad(`The description of "${name}" is longer than ${MANIFEST_LIMITS.description} characters.`);
    const input = schemaProblem(t.input, `${name}.input`);
    if (input) bad(input);
    const output = t.output === undefined ? null : schemaProblem(t.output, `${name}.output`);
    if (output) bad(output);
    const approval = approvalProblem(t.approval);
    if (approval) bad(`${name}: ${approval}`);
    const used = Array.isArray(t.accounts)
      ? t.accounts.filter((x): x is string => typeof x === "string")
      : [];
    for (const a of used)
      if (!(a in accounts))
        bad(`The tool "${name}" uses the account "${a}", which the app does not declare.`);
    const storage = storageOf(t.storage, name, t.kind === "mutation", bad);
    tools.push({
      name,
      kind: t.kind === "mutation" ? "mutation" : "query",
      description,
      input: (isRecord(t.input) ? t.input : {}) as AppToolManifest["input"],
      ...(isRecord(t.output) && { output: t.output as AppToolManifest["output"] }),
      ...(t.approval !== undefined && { approval: t.approval as AppToolManifest["approval"] }),
      accounts: [...new Set(used)],
      ...(storage && { storage }),
    });
  }
  if (problems.length) throw new ManifestError(problems);
  return {
    sdk: SDK_VERSION,
    tools,
    accounts,
    ...(page && { ui: { entry: page.entry, bytes: page.bytes } }),
  };
}

/** Reads a tool's `storage` declaration: personal collections, shared ones, and whether the tool may write. A query never writes. */
function storageOf(
  raw: unknown,
  tool: string,
  mutation: boolean,
  bad: (m: string) => void,
): AppToolManifest["storage"] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    bad(`The storage of "${tool}" is not valid.`);
    return undefined;
  }
  const names = (v: unknown, what: string) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !COLLECTION_NAME.test(x))) {
      bad(`The ${what} of "${tool}" must be names of lowercase letters, digits, - or _.`);
      return [];
    }
    return [...new Set(v as string[])];
  };
  const collections = names(raw.collections, "storage collections");
  const shared = names(raw.shared, "shared storage collections");
  if (collections.some((c) => shared.includes(c)))
    bad(`A collection of "${tool}" is both personal and shared.`);
  if (collections.length + shared.length > MANIFEST_LIMITS.collections)
    bad(`"${tool}" may use at most ${MANIFEST_LIMITS.collections} collections.`);
  const write = raw.write === true;
  if (write && !mutation)
    bad(`"${tool}" is a query, so it cannot write storage. Make it a mutation.`);
  if (collections.length + shared.length === 0) return undefined;
  return { collections, shared, write };
}

export type ManifestChanges = {
  added: string[];
  removed: string[];
  /** Tools whose kind, approval, accounts, storage or schemas differ. */
  changed: { name: string; what: string[] }[];
  accountsAdded: string[];
  accountsRemoved: string[];
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What a new version changes compared with the one before. A card for a publish shows this: it is what the person is agreeing to. */
export function diffManifests(
  prev: AppManifest | null | undefined,
  next: AppManifest,
): ManifestChanges {
  const before = new Map((prev?.tools ?? []).map((t) => [t.name, t]));
  const after = new Map(next.tools.map((t) => [t.name, t]));
  const changed: ManifestChanges["changed"] = [];
  for (const [name, t] of after) {
    const old = before.get(name);
    if (!old) continue;
    const what = [
      ...(old.kind !== t.kind ? ["kind"] : []),
      ...(!same(old.approval, t.approval) ? ["approval"] : []),
      ...(!same(old.accounts, t.accounts) ? ["accounts"] : []),
      ...(!same(old.storage, t.storage) ? ["storage"] : []),
      ...(!same(old.input, t.input) ? ["input"] : []),
      ...(!same(old.output, t.output) ? ["output"] : []),
    ];
    if (what.length) changed.push({ name, what });
  }
  const oldAccounts = Object.keys(prev?.accounts ?? {});
  const newAccounts = Object.keys(next.accounts);
  return {
    added: [...after.keys()].filter((n) => !before.has(n)),
    removed: [...before.keys()].filter((n) => !after.has(n)),
    changed,
    accountsAdded: newAccounts.filter((n) => !oldAccounts.includes(n)),
    accountsRemoved: oldAccounts.filter((n) => !newAccounts.includes(n)),
  };
}

/** A slug from a title: lowercase words joined by -, starting with a letter, at most 40 characters. */
export function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const s = /^[a-z]/.test(base) ? base : `app-${base}`.replace(/-+$/g, "");
  return s.slice(0, 40) || "app";
}

/** The first slug from `base` that `taken` does not hold: base, base-2, base-3... */
export function freeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base.slice(0, 40 - String(i).length - 1)}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`.slice(0, 40);
}
