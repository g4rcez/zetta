import { createHash } from "node:crypto";
import { ENTITY, haFetch } from "./homeassistant";
import type { PluginContext } from "./registry";

/**
 * A local copy of the Home Assistant home: every entity with its name, area, state and capabilities, and the services each domain
 * offers. The fast path matches a sentence against this copy instead of asking an AI. It is kept in memory, per Home Assistant
 * address and token, and refreshed when it is older than half an hour and the plugin is used again.
 */
export type HomeEntity = {
  id: string;
  domain: string;
  name: string;
  area?: string;
  state: string;
  features: number;
  attrs: Record<string, unknown>;
};
export type HomeCatalog = {
  at: number;
  entities: HomeEntity[];
  /** domain -> service names, for example light -> [turn_on, turn_off, toggle] */
  services: Record<string, string[]>;
};

export const CATALOG_TTL_MS = 30 * 60_000;
const MAX_KEYS = 100,
  MAX_LIST = 24,
  MAX_ENTITIES = 5000;
/** The only attributes the fast path needs. The rest (pictures, histories) is dropped. */
const ATTRS = [
  "source_list",
  "hvac_modes",
  "preset_modes",
  "min_temp",
  "max_temp",
  "supported_color_modes",
  "device_class",
  "unit_of_measurement",
] as const;
/** Area names and their entities in one call. Needs an administrator token: without it the catalog just has no areas. */
const AREAS_TEMPLATE =
  "{% set ns = namespace(r=[]) %}{% for a in areas() %}{% set ns.r = ns.r + [{'name': area_name(a), 'entities': area_entities(a)}] %}{% endfor %}{{ ns.r | to_json }}";

type Raw = { entity_id?: unknown; state?: unknown; attributes?: Record<string, unknown> };

const keep = (v: unknown) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_LIST) : v;

async function fetchCatalog(c: PluginContext, now: () => number): Promise<HomeCatalog> {
  const [states, services, areas] = await Promise.all([
    haFetch(c, "/api/states"),
    haFetch(c, "/api/services").catch(() => []),
    haFetch(c, "/api/template", { method: "POST", body: { template: AREAS_TEMPLATE } }).catch(
      () => [],
    ),
  ]);
  const areaOf = new Map<string, string>();
  for (const a of Array.isArray(areas) ? (areas as { name?: unknown; entities?: unknown }[]) : [])
    if (typeof a.name === "string" && Array.isArray(a.entities))
      for (const id of a.entities) if (typeof id === "string") areaOf.set(id, a.name);
  const entities: HomeEntity[] = [];
  for (const s of (Array.isArray(states) ? states : []) as Raw[]) {
    const id = String(s.entity_id ?? "");
    if (!ENTITY.test(id) || entities.length >= MAX_ENTITIES) continue;
    const attrs: Record<string, unknown> = {};
    for (const k of ATTRS) if (s.attributes?.[k] !== undefined) attrs[k] = keep(s.attributes[k]);
    const name = s.attributes?.friendly_name;
    const features = s.attributes?.supported_features;
    entities.push({
      id,
      domain: id.split(".")[0]!,
      name: typeof name === "string" && name ? name : id.split(".")[1]!.replace(/_/g, " "),
      area: areaOf.get(id),
      state: String(s.state ?? ""),
      features: typeof features === "number" ? features : 0,
      attrs,
    });
  }
  const byDomain: Record<string, string[]> = {};
  for (const d of (Array.isArray(services) ? services : []) as {
    domain?: unknown;
    services?: Record<string, unknown>;
  }[])
    if (typeof d.domain === "string" && d.services) byDomain[d.domain] = Object.keys(d.services);
  return { at: now(), entities, services: byDomain };
}

const entries = new Map<string, { catalog?: HomeCatalog; loading?: Promise<HomeCatalog> }>();

/** Key by address and token, hashed: a changed setting is a new catalog and no token sits in a map key. */
const keyOf = (c: PluginContext) =>
  createHash("sha256").update(`${c.config.baseUrl}\n${c.config.token}`).digest("hex");

/**
 * The catalog of one Home Assistant. Fresh: from memory. Older than half an hour: the old one is returned at once and a single
 * refresh runs in the background (a failed refresh keeps the old one). Never loaded: waits for the first load.
 */
export async function homeCatalog(c: PluginContext, now: () => number = Date.now) {
  const key = keyOf(c);
  let e = entries.get(key);
  if (!e) {
    e = {};
    entries.set(key, e);
    if (entries.size > MAX_KEYS) entries.delete(entries.keys().next().value!);
  }
  if (e.catalog && now() - e.catalog.at < CATALOG_TTL_MS) return e.catalog;
  const entry = e;
  entry.loading ??= fetchCatalog(c, now)
    .then((catalog) => (entry.catalog = catalog))
    .finally(() => {
      entry.loading = undefined;
    });
  if (!entry.catalog) return entry.loading;
  entry.loading.catch(() => {});
  return entry.catalog;
}

/** For tests: forget every catalog. */
export const forgetHomeCatalogs = () => entries.clear();
