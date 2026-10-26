import { assertPublicUrl } from "../../../computer/service";
import { PluginError, registerPlugin, type CredentialField, type PluginContext } from "../registry";
import { clean, json, run, vaultFetch, vaultPolicy } from "./exec";
import { pickMode, vaultPlugin, type VaultAdapter, type VaultItem } from "./shared";
import { totp } from "./totp";

/**
 * 1Password, two ways (https://developer.1password.com):
 *   - Service account: a token scoped to chosen vaults, used through the official CLI (`op`, with OP_SERVICE_ACCOUNT_TOKEN in its env).
 *   - Connect server: the user's self-hosted 1Password Connect REST API (url + access token), fetched directly. Its address follows the
 *     platform's private-address policy (a Connect server on the LAN needs the administrator's allowPrivate switch), redirects are refused.
 * Item ids are `<vault id>/<item id>`. Only Login and Password items are offered; values are read one field at a time, on demand.
 */
const OP = "op", LABEL = "1Password CLI", TIMEOUT_MS = 20_000;
type OpUrl = { href?: string };
type OpItem = { id: string; title?: string; category?: string; vault?: { id: string }; urls?: OpUrl[] };
type OpField = { type?: string; purpose?: string; label?: string; value?: string; totp?: string };

const fieldsFor = (category: string | undefined): CredentialField[] => (category ?? "").toUpperCase() === "PASSWORD" ? ["password"] : ["username", "password", "totp"];
const toItem = (vault: string, i: OpItem): VaultItem => ({ id: `${vault}/${i.id}`, title: clean(i.title, 120) || "(untitled)", urls: (i.urls ?? []).map((u) => clean(u.href, 300)).filter(Boolean).slice(0, 10), fields: fieldsFor(i.category) });
const split = (id: string) => { const [vault, item, extra] = id.split("/"); if (!vault || !item || extra !== undefined) throw new PluginError("INVALID_ARGS", "That 1Password item id is not valid."); return { vault, item }; };
/** A value from an item's fields; TOTP comes from the field's current code or is computed from its seed. */
function pick(fields: OpField[], field: CredentialField): string {
  if (field === "totp") { const f = fields.find((x) => (x.type ?? "").toUpperCase() === "OTP"); if (!f) return ""; if (f.totp) return f.totp; try { return f.value ? totp(f.value) : ""; } catch { return ""; } }
  const purpose = field === "username" ? "USERNAME" : "PASSWORD";
  return fields.find((x) => (x.purpose ?? "").toUpperCase() === purpose)?.value ?? fields.find((x) => (x.label ?? "").toLowerCase() === field)?.value ?? "";
}

function serviceAccount(c: PluginContext): VaultAdapter {
  const env = { OP_SERVICE_ACCOUNT_TOKEN: c.config.serviceAccountToken!.trim(), OP_INTEGRATION_NAME: "Zetta", OP_INTEGRATION_ID: "zetta" };
  async function op(argv: string[]) {
    const r = await run(OP, LABEL, argv, env);
    if (r.code === 0) return r.stdout;
    const why = r.stderr.toLowerCase();
    if (/unauthori[sz]ed|invalid.*token|authentication|service account.*(deleted|expired|revoked)/.test(why)) throw new PluginError("AUTH", "1Password rejected the service account token.", "Create a new token in 1Password (Developer > Service accounts), then remove and install the 1Password plugin again.");
    if (/isn't an item|not found|no item/.test(why)) throw new PluginError("ITEM_NOT_FOUND", "1Password could not find that item, or the service account cannot read its vault.", "Give the service account access to the item's vault in 1Password.");
    if (/rate limit|too many requests/.test(why)) throw new PluginError("RATE_LIMITED", "1Password is rate limiting this service account.", "Wait a minute and try again.");
    throw new PluginError("VAULT_ERROR", "The 1Password CLI could not complete that.", "Check that the server can reach 1Password, then try again.");
  }
  return {
    mode: "service-account",
    async probe() { await op(["vault", "list", "--format", "json"]); },
    async list() {
      const rows = json<OpItem[]>(await op(["item", "list", "--categories", "Login,Password", "--format", "json"]), "1Password");
      return (Array.isArray(rows) ? rows : []).filter((i) => i?.id && i.vault?.id).map((i) => toItem(i.vault!.id, i));
    },
    async reveal(id, field) {
      const { vault, item } = split(id);
      if (field === "totp") return (await op(["item", "get", item, "--vault", vault, "--otp"])).trim();
      const full = json<{ fields?: OpField[] }>(await op(["item", "get", item, "--vault", vault, "--format", "json", "--reveal"]), "1Password");
      return pick(full.fields ?? [], field);
    },
  };
}

function connectServer(c: PluginContext): VaultAdapter {
  const base = c.config.connectUrl!.trim().replace(/\/+$/, ""), token = c.config.connectToken!.trim();
  async function api<T>(path: string): Promise<T> {
    if (!vaultPolicy().allowPrivate) await assertPublicUrl(base).catch(() => { throw new PluginError("BLOCKED_URL", "That Connect server address is not allowed (private addresses must be enabled by the administrator)."); });
    let res: Response;
    try { res = await vaultFetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw new PluginError("UNREACHABLE", "The 1Password Connect server could not be reached.", "Check the Connect server address and that it is running."); }
    if (res.status === 401 || res.status === 403) throw new PluginError("AUTH", "The Connect server rejected the access token.", "Create a new Connect token with read access, then remove and install the 1Password plugin again.");
    if (res.status === 404) throw new PluginError("ITEM_NOT_FOUND", "The Connect server could not find that item.", "Check that the Connect token can read the item's vault.");
    if (!res.ok) throw new PluginError("VAULT_ERROR", `The Connect server answered HTTP ${res.status}.`, "Check the Connect server's logs, then try again.");
    return json<T>(await res.text(), "The Connect server");
  }
  return {
    mode: "connect",
    async probe() { await api("/v1/vaults"); },
    async list() {
      const vaults = (await api<{ id: string }[]>("/v1/vaults")).slice(0, 25), out: VaultItem[] = [];
      for (const v of vaults) {
        if (!/^[A-Za-z0-9]{1,64}$/.test(v.id ?? "")) continue;
        for (const i of await api<OpItem[]>(`/v1/vaults/${v.id}/items`)) if (["LOGIN", "PASSWORD"].includes((i.category ?? "").toUpperCase())) out.push(toItem(v.id, i));
      }
      return out;
    },
    async reveal(id, field) {
      const { vault, item } = split(id);
      return pick((await api<{ fields?: OpField[] }>(`/v1/vaults/${encodeURIComponent(vault)}/items/${encodeURIComponent(item)}`)).fields ?? [], field);
    },
  };
}

export const ONEPASSWORD = registerPlugin(vaultPlugin({
  id: "1password", name: "1Password", icon: "key-round", docsUrl: "https://developer.1password.com/docs/service-accounts/",
  description: "Let bots sign in to websites with logins you share from 1Password. Bots never see the passwords: Zetta types them on the right site.",
  notes: "Use EITHER a service account token (recommended: create one in 1Password > Developer > Service accounts with read access to a dedicated vault) OR a 1Password Connect server URL and token. Nothing is shared until you pick logins under Shared logins.",
  fields: [
    { key: "serviceAccountToken", label: "Service account token", secret: true, optional: true, kind: "password", placeholder: "ops_...", help: "Option 1. Read-only access to the vaults bots may use. Leave the Connect fields empty." },
    { key: "connectUrl", label: "Connect server URL", optional: true, kind: "url", placeholder: "https://op-connect.example.com", help: "Option 2, for a self-hosted 1Password Connect server. Leave the service account token empty." },
    { key: "connectToken", label: "Connect access token", secret: true, optional: true, kind: "password", help: "Option 2: a Connect token with read access." },
  ],
  adapter: (c) => pickMode("1Password", c.config, { "service-account": ["serviceAccountToken"], connect: ["connectUrl", "connectToken"] }) === "connect" ? connectServer(c) : serviceAccount(c),
}));
