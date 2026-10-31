import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPublicUrl } from "../../../computer/service";
import { PluginError, registerPlugin, type CredentialField, type PluginContext } from "../registry";
import { clean, json, run, vaultPolicy } from "./exec";
import {
  itemRows,
  named,
  pickMode,
  vaultPlugin,
  type VaultAdapter,
  type VaultItem,
} from "./shared";

/**
 * Bitwarden (and Vaultwarden, through the server URL), two ways (https://bitwarden.com/help):
 *   - Secrets Manager: a machine account access token, through the official `bws` CLI. Each secret is offered as a password (its key is
 *     the title); there are no websites stored, so the user types the sites when sharing one.
 *   - Personal vault: an API key (client_id/client_secret) plus the master password, through the official `bw` CLI. Every user gets their
 *     own CLI data directory; the unlocked session key is kept in memory for a few minutes and passed by env (BW_SESSION), never argv.
 */
const BWS = "bws",
  BW = "bw",
  SESSION_MS = 10 * 60_000;

/** The CLIs call the configured server from this host, so it follows the same address policy as the 1Password Connect server. */
async function guardServer(c: PluginContext) {
  const url = c.config.serverUrl?.trim();
  if (url && !vaultPolicy().allowPrivate)
    await assertPublicUrl(url).catch(() => {
      throw new PluginError(
        "BLOCKED_URL",
        "That Bitwarden server address is not allowed (private addresses must be enabled by the administrator).",
      );
    });
}

// ---- Secrets Manager -------------------------------------------------------------------------------------------------------------------
function secretsManager(c: PluginContext): VaultAdapter {
  const env: Record<string, string> = {
    BWS_ACCESS_TOKEN: c.config.accessToken!.trim(),
    ...(c.config.serverUrl?.trim() ? { BWS_SERVER_URL: c.config.serverUrl.trim() } : {}),
  };
  async function bws(argv: string[]) {
    await guardServer(c);
    const r = await run(
      BWS,
      "Bitwarden Secrets Manager CLI",
      [...argv, "--output", "json", "--color", "no"],
      env,
    );
    if (r.code === 0) return r.stdout;
    const why = r.stderr.toLowerCase();
    if (/access token|unauthori[sz]ed|invalid_client|401/.test(why))
      throw new PluginError(
        "AUTH",
        "Bitwarden rejected the machine account access token.",
        "Create a new access token for the machine account in Bitwarden Secrets Manager, then remove and install the Bitwarden plugin again.",
      );
    if (/not found|404|resource/.test(why))
      throw new PluginError(
        "ITEM_NOT_FOUND",
        "Bitwarden could not find that secret, or the machine account cannot read it.",
        "Give the machine account access to the secret's project.",
      );
    throw new PluginError(
      "VAULT_ERROR",
      "The Bitwarden Secrets Manager CLI could not complete that.",
      "Check that the server can reach Bitwarden, then try again.",
    );
  }
  const adapter: VaultAdapter = {
    mode: "secrets-manager",
    cli: {
      "bws project list": async () => named(json(await bws(["project", "list"]), "Bitwarden")),
      "bws secret list": () => itemRows(adapter),
    },
    async probe() {
      await bws(["project", "list"]);
    },
    async list() {
      // The listing includes values: keep only ids and keys.
      const rows = json<{ id?: string; key?: string }[]>(
        await bws(["secret", "list"]),
        "Bitwarden",
      );
      return (Array.isArray(rows) ? rows : [])
        .filter((s) => typeof s?.id === "string")
        .map((s): VaultItem => ({
          id: s.id!,
          title: clean(s.key, 120) || "(unnamed secret)",
          urls: [],
          fields: ["password"],
        }));
    },
    async reveal(id, field) {
      if (field !== "password") return "";
      return json<{ value?: string }>(await bws(["secret", "get", id]), "Bitwarden").value ?? "";
    },
  };
  return adapter;
}

// ---- Personal vault (bw) ---------------------------------------------------------------------------------------------------------------
const sessions = new Map<string, { key: string; at: number }>(); // per user+account: unlocked session key (memory only)
/** Test helper. */
export const resetBitwardenSessions = () => sessions.clear();
const accountKey = (c: PluginContext) =>
  createHash("sha256")
    .update(`${c.userId}\u0000${c.config.serverUrl ?? ""}\u0000${c.config.clientId ?? ""}`)
    .digest("hex")
    .slice(0, 32);
const dataDir = (c: PluginContext) => join(tmpdir(), "zetta-bw", accountKey(c));
type BwItem = {
  id?: string;
  name?: string;
  type?: number;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string }[] | null;
  };
};

function personal(c: PluginContext): VaultAdapter {
  const dir = dataDir(c),
    base = { BITWARDENCLI_APPDATA_DIR: dir, BW_NOINTERACTION: "true", BW_NOCOLOR: "true" },
    key = accountKey(c);
  const auth = () => {
    sessions.delete(key);
    return new PluginError(
      "AUTH",
      "Bitwarden rejected the API key or the master password.",
      "Check them in Bitwarden (Account settings > Security > Keys > View API key), then remove and install the Bitwarden plugin again.",
    );
  };
  async function bw(argv: string[], extra: Record<string, string> = {}) {
    await guardServer(c);
    const r = await run(BW, "Bitwarden CLI", argv, { ...base, ...extra });
    if (r.code === 0) return r.stdout;
    const why = r.stderr.toLowerCase();
    if (
      /invalid master password|username or password is incorrect|invalid_client|invalid api key|not logged in|vault is locked|session key is invalid/.test(
        why,
      )
    )
      throw auth();
    if (/two-step|two factor|new device/.test(why))
      throw new PluginError(
        "NEEDS_AUTH",
        "Bitwarden asked for a second sign-in step.",
        "API key logins skip two-step login; check the client id and secret, or use Secrets Manager instead.",
      );
    if (/not found/.test(why))
      throw new PluginError(
        "ITEM_NOT_FOUND",
        "Bitwarden could not find that item.",
        "It may have been deleted or moved; share it again in Studio > Plugins > Bitwarden.",
      );
    if (/more than one result/.test(why))
      throw new PluginError("VAULT_ERROR", "Bitwarden found several matching values.");
    throw new PluginError(
      "VAULT_ERROR",
      "The Bitwarden CLI could not complete that.",
      "Check that the server can reach your Bitwarden server, then try again.",
    );
  }
  async function session(): Promise<string> {
    const hit = sessions.get(key);
    if (hit && Date.now() - hit.at < SESSION_MS) return hit.key;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const status = json<{ status?: string }>(await bw(["status"]), "Bitwarden").status;
    if (status === "unauthenticated") {
      if (c.config.serverUrl?.trim()) await bw(["config", "server", c.config.serverUrl.trim()]);
      await bw(["login", "--apikey"], {
        BW_CLIENTID: c.config.clientId!.trim(),
        BW_CLIENTSECRET: c.config.clientSecret!.trim(),
      });
    }
    const s = (
      await bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
        BW_PASSWORD: c.config.masterPassword!,
      })
    ).trim();
    if (!s) throw auth();
    await bw(["sync"], { BW_SESSION: s }).catch(() => undefined); // stale but usable data beats failing the call
    sessions.set(key, { key: s, at: Date.now() });
    return s;
  }
  const withSession = async (argv: string[]) => bw(argv, { BW_SESSION: await session() });
  const adapter: VaultAdapter = {
    mode: "personal",
    cli: {
      ...Object.fromEntries(
        ["folders", "collections", "organizations"].map((what) => [
          `bw list ${what}`,
          async () => named(json(await withSession(["list", what]), "Bitwarden")),
        ]),
      ),
      "bw list items": () => itemRows(adapter),
    },
    async probe() {
      await session();
    },
    async list() {
      // The listing includes values: keep only metadata and which fields are present.
      const rows = json<BwItem[]>(await withSession(["list", "items"]), "Bitwarden");
      return (Array.isArray(rows) ? rows : [])
        .filter((i) => i?.type === 1 && typeof i.id === "string" && i.login)
        .map((i): VaultItem => ({
          id: i.id!,
          title: clean(i.name, 120) || "(untitled)",
          urls: (i.login!.uris ?? [])
            .map((u) => clean(u.uri, 300))
            .filter(Boolean)
            .slice(0, 10),
          fields: (["username", "password", "totp"] as CredentialField[]).filter((f) =>
            Boolean(i.login![f]),
          ),
        }));
    },
    async reveal(id, field) {
      return (await withSession(["get", field, id])).trim();
    },
  };
  return adapter;
}

export const BITWARDEN = registerPlugin({
  ...vaultPlugin({
    id: "bitwarden",
    name: "Bitwarden",
    icon: "key-round",
    docsUrl: "https://bitwarden.com/help/cli/",
    description:
      "Let bots sign in to websites with logins you share from Bitwarden or Vaultwarden. Bots never see the passwords: Zetta types them on the right site.",
    notes:
      "Use EITHER a Secrets Manager machine account access token OR your personal vault's API key plus master password (stored encrypted; prefer a dedicated account holding only the logins bots need). Nothing is shared until you pick logins under Shared logins.",
    fields: [
      {
        key: "accessToken",
        label: "Secrets Manager access token",
        secret: true,
        optional: true,
        kind: "password",
        placeholder: "0.48c7...",
        help: "Option 1: a machine account access token. Leave the personal vault fields empty.",
      },
      {
        key: "clientId",
        label: "API key client_id",
        optional: true,
        placeholder: "user.xxxxxxxx-...",
        help: "Option 2: from Account settings > Security > Keys > View API key.",
      },
      {
        key: "clientSecret",
        label: "API key client_secret",
        secret: true,
        optional: true,
        kind: "password",
        help: "Option 2.",
      },
      {
        key: "masterPassword",
        label: "Master password",
        secret: true,
        optional: true,
        kind: "password",
        help: "Option 2: unlocks the vault on the server. Stored encrypted for your account only.",
      },
      {
        key: "serverUrl",
        label: "Server URL (self-hosted only)",
        optional: true,
        kind: "url",
        placeholder: "https://vault.example.com",
        help: "Leave empty for bitwarden.com. Set it for Vaultwarden or a self-hosted Bitwarden.",
      },
    ],
    cliCommands: [
      "bw list folders",
      "bw list collections",
      "bw list organizations",
      "bw list items",
      "bws project list",
      "bws secret list",
    ],
    adapter: (c) =>
      pickMode("Bitwarden", c.config, {
        "secrets-manager": ["accessToken"],
        personal: ["clientId", "clientSecret", "masterPassword"],
      }) === "personal"
        ? personal(c)
        : secretsManager(c),
  }),
  /** Signs the server's CLI out of the personal vault and deletes its local data (runs on uninstall). */
  async disconnect(ctx) {
    sessions.delete(accountKey(ctx));
    if (ctx.config.clientId) {
      await run(BW, "Bitwarden CLI", ["logout"], {
        BITWARDENCLI_APPDATA_DIR: dataDir(ctx),
        BW_NOINTERACTION: "true",
      }).catch(() => undefined);
      await rm(dataDir(ctx), { recursive: true, force: true }).catch(() => undefined);
    }
  },
});
