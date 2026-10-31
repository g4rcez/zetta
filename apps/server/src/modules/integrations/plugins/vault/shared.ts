import { CREDENTIAL_FIELDS, originPattern } from "../credentials";
import {
  PluginError,
  type CredentialField,
  type CredentialGrant,
  type PluginContext,
  type PluginDef,
  type PluginField,
  type PluginStatus,
} from "../registry";
import { clean, ITEM_ID } from "./exec";

/** One vault entry as Zetta shows it: metadata only, never a value. `fields` are the kinds the item can fill. */
export type VaultItem = { id: string; title: string; urls: string[]; fields: CredentialField[] };
/** A connection to one vault account, built from the user's config for one call. */
export type VaultAdapter = {
  /** Which of the plugin's connection styles the config selects (shown in Studio). */
  mode: string;
  probe(): Promise<void>;
  list(): Promise<VaultItem[]>;
  reveal(id: string, field: CredentialField): Promise<string>;
  /** The CLI commands bots may ask for, by their exact text. Each answers with sanitized metadata rows; absent when the connection style has no CLI. */
  cli?: Record<string, () => Promise<Record<string, unknown>[]>>;
};
/** The settings choice that gates the `cli` tool. Enum, not a flag: a wider level can be added later without migrating stored values. */
export const CLI_ACCESS: PluginField = {
  key: "cliAccess",
  label: "Bot access to the CLI",
  kind: "select",
  optional: true,
  options: [
    { value: "off", label: "Off: bots only use shared logins" },
    { value: "metadata", label: "Metadata only: bots may list vaults and items (no passwords)" },
  ],
  help: "Lets bots run the read-only list commands of the password manager's CLI. Passwords, codes and notes are never returned.",
};
/** Rows of `{ id, name }` from a CLI listing that may carry other keys (including values). */
export const named = (rows: unknown): { id: string; name: string }[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((r) => typeof r?.id === "string")
    .map((r) => ({ id: r.id, name: clean(r.name, 120) }));
/** A vault listing as CLI rows: titles, sites and field kinds, no values. */
export const itemRows = async (a: VaultAdapter) =>
  (await a.list()).map(({ id, title, urls, fields }) => ({ id, title, urls, fields }));

const MAX_GRANTS = 100,
  MAX_ORIGINS = 10,
  MAX_BROWSE = 200;

/** Grants live in the plugin's sealed config (the only per-install storage a plugin has), so even login titles stay encrypted at rest. */
export function grantsOf(c: PluginContext): CredentialGrant[] {
  try {
    const v = JSON.parse(c.config.grants ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (g) =>
          g &&
          typeof g.id === "string" &&
          ITEM_ID.test(g.id) &&
          Array.isArray(g.origins) &&
          Array.isArray(g.fields),
      )
      .slice(0, MAX_GRANTS)
      .map((g) => ({
        id: g.id,
        title: clean(g.title, 120),
        origins: g.origins
          .map(String)
          .map(originPattern)
          .filter(Boolean)
          .slice(0, MAX_ORIGINS) as string[],
        fields: g.fields.filter((f: unknown): f is CredentialField =>
          CREDENTIAL_FIELDS.includes(f as CredentialField),
        ),
      }));
  } catch {
    return [];
  }
}
const saveGrants = (c: PluginContext, grants: CredentialGrant[]) =>
  c.setConfig({ ...c.config, grants: JSON.stringify(grants) });
/** Only grant data in the sealed config is ours; everything else is the user's connection settings. */
const connectionOnly = (c: PluginContext): PluginContext => {
  const { grants: _g, ...rest } = c.config;
  return { ...c, config: rest };
};

/** Same host suffix rules as `originPattern`; the vault's own URLs give the default sites for a new grant. */
const defaultOrigins = (urls: string[]) =>
  [...new Set(urls.map(originPattern).filter(Boolean) as string[])].slice(0, MAX_ORIGINS);

/**
 * Builds a password-manager plugin. Bots get ONE read tool (`list_credentials`: the logins the user shared, no values); the values are
 * typed by the chat service through `credentials.reveal` after its own checks. Studio manages grants through `connect` options:
 *   { browse: { query? } }                         -> data.items: vault items (metadata) with their grant, if any
 *   { grant: { id, origins?: string[], fields? } } -> shares one item (title and default sites come from the vault, not the browser)
 *   { revoke: { id } }                             -> stops sharing it
 */
export function vaultPlugin(
  o: Omit<
    PluginDef,
    | "kind"
    | "auth"
    | "category"
    | "tools"
    | "install"
    | "status"
    | "connect"
    | "credentials"
    | "fields"
  > & { fields: PluginField[]; cliCommands: string[]; adapter(ctx: PluginContext): VaultAdapter },
): PluginDef {
  const adapter = (c: PluginContext) => o.adapter(connectionOnly(c));
  async function find(c: PluginContext, id: string) {
    if (!ITEM_ID.test(id))
      throw new PluginError("INVALID_ARGS", "That vault item id is not valid.");
    const item = (await adapter(c).list()).find((i) => i.id === id);
    if (!item)
      throw new PluginError(
        "ITEM_NOT_FOUND",
        `${o.name} has no such item, or this connection cannot read it.`,
        `Check that the item is in a vault this ${o.name} connection can access.`,
      );
    return item;
  }
  const { adapter: _a, cliCommands, ...def } = o;
  return {
    ...def,
    fields: [...o.fields, CLI_ACCESS],
    kind: "native",
    auth: "api-key",
    category: "security",
    async install(ctx) {
      await adapter(ctx).probe();
    },
    async status(ctx): Promise<PluginStatus> {
      const grants = grantsOf(ctx);
      try {
        const a = adapter(ctx);
        await a.probe();
        return { state: "connected", info: { mode: a.mode, grants } };
      } catch (e) {
        if (e instanceof PluginError) return { state: "error", detail: e.safe, info: { grants } };
        throw e;
      }
    },
    async connect(ctx, options = {}) {
      if (options.browse && typeof options.browse === "object") {
        const q = clean((options.browse as { query?: unknown }).query, 100).toLowerCase();
        const grants = new Map(grantsOf(ctx).map((g) => [g.id, g]));
        const items = (await adapter(ctx).list())
          .filter((i) => !q || `${i.title} ${i.urls.join(" ")}`.toLowerCase().includes(q))
          .slice(0, MAX_BROWSE);
        return { data: { items: items.map((i) => ({ ...i, grant: grants.get(i.id) ?? null })) } };
      }
      if (options.grant && typeof options.grant === "object") {
        const g = options.grant as { id?: unknown; origins?: unknown; fields?: unknown };
        const item = await find(ctx, String(g.id ?? ""));
        const asked = Array.isArray(g.origins) ? g.origins.map(String) : undefined;
        const origins = asked
          ? [
              ...new Set(
                asked.map((x) => {
                  const p = originPattern(x);
                  if (!p)
                    throw new PluginError(
                      "INVALID_ARGS",
                      `"${clean(x, 60)}" is not a site address (use github.com or *.example.com).`,
                    );
                  return p;
                }),
              ),
            ]
          : defaultOrigins(item.urls);
        if (!origins.length)
          throw new PluginError(
            "NO_ORIGINS",
            `"${item.title}" has no website saved in ${o.name}.`,
            "Type the site where bots may sign in with it (for example github.com).",
          );
        if (origins.length > MAX_ORIGINS)
          throw new PluginError("INVALID_ARGS", `At most ${MAX_ORIGINS} sites per login.`);
        const fields = Array.isArray(g.fields)
          ? CREDENTIAL_FIELDS.filter((f) => (g.fields as unknown[]).includes(f))
          : item.fields.filter((f) => f !== "totp");
        if (!fields.length || fields.some((f) => !item.fields.includes(f)))
          throw new PluginError(
            "INVALID_ARGS",
            `Choose at least one of: ${item.fields.join(", ")}.`,
          );
        const rest = grantsOf(ctx).filter((x) => x.id !== item.id);
        if (rest.length >= MAX_GRANTS)
          throw new PluginError(
            "TOO_MANY",
            `At most ${MAX_GRANTS} logins can be shared with bots.`,
            "Stop sharing one you no longer need.",
          );
        const grant: CredentialGrant = { id: item.id, title: item.title, origins, fields };
        await saveGrants(ctx, [...rest, grant]);
        return {
          message: `Bots can now sign in with "${item.title}" on ${origins.join(", ")}.`,
          data: { grant },
        };
      }
      if (options.revoke && typeof options.revoke === "object") {
        const id = String((options.revoke as { id?: unknown }).id ?? "");
        const all = grantsOf(ctx);
        await saveGrants(
          ctx,
          all.filter((x) => x.id !== id),
        );
        return { message: "Bots can no longer use that login." };
      }
      await adapter(ctx).probe();
      return { message: `Connected to ${o.name}.` };
    },
    credentials: {
      grants: async (ctx) => grantsOf(ctx),
      async reveal(ctx, itemId, field) {
        if (!ITEM_ID.test(itemId))
          throw new PluginError("INVALID_ARGS", "That vault item id is not valid.");
        const v = await adapter(ctx).reveal(itemId, field);
        if (!v)
          throw new PluginError(
            "FIELD_EMPTY",
            `That login has no ${field} saved in ${o.name}.`,
            `Add the ${field} to the item in ${o.name}, or untick it in Studio.`,
          );
        return v;
      },
    },
    tools: [
      {
        name: "list_credentials",
        description:
          "Logins the user shared with you for signing in: ref, title, the sites where each may be used and which fields can be filled. Never returns passwords; fill them with zetta:credential.",
        inputSchema: {
          type: "object",
          properties: {
            site: { type: "string", description: "Optional host to filter by, e.g. github.com" },
          },
        },
        async handler(ctx, args) {
          const site = typeof args.site === "string" ? originPattern(args.site) : undefined;
          const rows = grantsOf(ctx).filter(
            (g) =>
              !site ||
              g.origins.some(
                (p) =>
                  p === site ||
                  (p.startsWith("*.") && (site === p.slice(2) || site.endsWith(p.slice(1)))),
              ),
          );
          return {
            credentials: rows.map((g) => ({
              ref: `${o.id}:${g.id}`,
              title: g.title,
              sites: g.origins,
              fields: g.fields,
            })),
            ...(rows.length
              ? {}
              : {
                  notice:
                    "No shared logins match. Ask the user to share one in Studio > Plugins, or hand off with zetta:handoff.",
                }),
          };
        },
      },
      {
        name: "cli",
        description: `Runs a read-only listing of the ${o.name} CLI, only when the user turned on CLI access in the plugin settings. Commands: ${cliCommands.join(", ")}. Returns metadata rows (ids, names, titles, sites), never passwords, codes or notes; to sign in use list_credentials and zetta:credential.`,
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: `Exactly one of: ${cliCommands.join(" | ")}` },
            search: { type: "string", description: "Optional text to filter the rows by" },
          },
          required: ["command"],
        },
        async handler(ctx, args) {
          if (ctx.config.cliAccess !== "metadata")
            throw new PluginError(
              "CLI_DISABLED",
              `CLI access is off for ${o.name}.`,
              `Ask the user to choose "Metadata only" under Bot access to the CLI in Studio > Plugins > ${o.name} > Settings.`,
            );
          const commands = adapter(ctx).cli ?? {},
            name = String(args.command ?? "")
              .trim()
              .replace(/\s+/g, " ");
          if (!Object.hasOwn(commands, name))
            throw new PluginError(
              "CLI_COMMAND",
              `That command is not available. Available: ${Object.keys(commands).join(", ") || "none with this connection"}.`,
            );
          const q = clean(args.search, 100).toLowerCase(),
            rows = (await commands[name]!()).filter(
              (r) => !q || JSON.stringify(r).toLowerCase().includes(q),
            );
          return {
            rows: rows.slice(0, MAX_BROWSE),
            ...(rows.length > MAX_BROWSE
              ? { notice: `Showing ${MAX_BROWSE} of ${rows.length}; pass search to narrow it.` }
              : {}),
          };
        },
      },
    ],
  };
}

/** Exactly one connection style must be filled; `styles` maps a mode name to the config keys it needs. */
export function pickMode<M extends string>(
  name: string,
  config: Readonly<Record<string, string>>,
  styles: Record<M, readonly string[]>,
): M {
  const filled = (k: string) => Boolean(config[k]?.trim());
  const started = (Object.keys(styles) as M[]).filter((m) => styles[m].some(filled));
  if (started.length > 1)
    throw new PluginError(
      "INVALID_FIELD",
      `Fill only one way of connecting to ${name}.`,
      `Remove ${name} and install it again with just one set of credentials.`,
    );
  const mode = started[0];
  if (!mode)
    throw new PluginError(
      "MISSING_FIELD",
      `Enter the credentials for one way of connecting to ${name}.`,
    );
  const missing = styles[mode].filter((k) => !filled(k));
  if (missing.length) throw new PluginError("MISSING_FIELD", `Also fill: ${missing.join(", ")}.`);
  return mode;
}
