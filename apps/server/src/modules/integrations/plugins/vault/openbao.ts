import { createHash } from "node:crypto";
import { assertPublicUrl } from "../../../computer/service";
import { PluginError, registerPlugin, type CredentialField, type PluginContext } from "../registry";
import { clean, json, vaultAllowsPrivate, vaultFetch } from "./exec";
import {
  itemRows,
  named,
  pickMode,
  vaultPlugin,
  type VaultAdapter,
  type VaultItem,
} from "./shared";
import { totp } from "./totp";

/**
 * OpenBao (https://openbao.org), also HashiCorp Vault, whose HTTP API it follows. The user's own server is reached over its HTTP API (no
 * CLI, no SDK) with a token or an AppRole (role id + secret id), an optional namespace and a KV mount (version 2, or 1 when the mount says so).
 * An item is one KV secret, its id the path under the mount. Its keys map to the fields:
 *   username: username | user | login | email      password: password | pass | pwd      totp: totp | otp | totp_secret | totp_seed | otpauth
 * Default sites come from the vault: a url-like key (url, urls, uri, website, site, sites) or the secret's custom metadata of the same names.
 * The base address follows the platform's private-address policy (like the 1Password Connect server) and redirects are refused.
 * Nothing the server answers is echoed in an error: bodies of secrets hold values.
 */
const TIMEOUT_MS = 20_000,
  MAX_BODY = 4_000_000,
  MAX_DEPTH = 4,
  MAX_ITEMS = 200,
  PARALLEL = 6,
  TOKEN_FALLBACK_S = 300,
  MOUNT_TTL_MS = 10 * 60_000;
const KEYS: Record<CredentialField, readonly string[]> = {
  username: ["username", "user", "login", "email"],
  password: ["password", "pass", "pwd"],
  totp: ["totp", "otp", "totp_secret", "totp_seed", "otpauth"],
};
const SITE_KEYS = ["url", "urls", "uri", "website", "site", "sites"];
const MOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,3}$/;
const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;

type Secret = { data: Record<string, unknown>; meta: Record<string, unknown> };
type Cfg = { mount: string; prefix: string; version: 1 | 2 };

const tokens = new Map<string, { token: string; until: number }>(); // AppRole client tokens, memory only
const mounts = new Map<string, { version: 1 | 2; until: number }>();
/** Test helper. */
export const resetOpenBaoState = () => {
  tokens.clear();
  mounts.clear();
};

/** A key's string value, case-insensitive, first non-empty match in the order of `names`. */
function valueOf(data: Record<string, unknown>, names: readonly string[]): string {
  const lower = new Map(Object.entries(data).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower.get(n);
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}
/** Site strings from a map's url-like keys (a value may hold several, separated by space, comma or semicolon). */
const sitesOf = (m: Record<string, unknown>) =>
  SITE_KEYS.flatMap((k) => valueOf(m, [k]).split(/[\s,;]+/)).filter(Boolean);
const fieldsOf = (data: Record<string, unknown>): CredentialField[] =>
  (["username", "password", "totp"] as CredentialField[]).filter((f) =>
    Boolean(valueOf(data, KEYS[f])),
  );
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Path pieces that are safe to put into a URL path: no empty, dot or dot-dot segment. */
const safePath = (p: string) => p.split("/").every((s) => s && s !== "." && s !== "..");
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function openbao(c: PluginContext): VaultAdapter {
  const raw = c.config.baseUrl?.trim() ?? "";
  let base: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    base = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    throw new PluginError(
      "INVALID_FIELD",
      "The OpenBao server address is not a valid URL.",
      "Use the address of your server, for example https://bao.example.com:8200.",
    );
  }
  const namespace = c.config.namespace?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (namespace && !(NAMESPACE.test(namespace) && safePath(namespace)))
    throw new PluginError("INVALID_FIELD", "That OpenBao namespace is not valid.");
  const mount = (c.config.mount?.trim() || "secret").replace(/^\/+|\/+$/g, "");
  const prefix = (c.config.prefix?.trim() ?? "").replace(/^\/+|\/+$/g, "");
  const approleMount = (c.config.approleMount?.trim() || "approle").replace(/^\/+|\/+$/g, "");
  if (!MOUNT.test(mount) || !safePath(mount) || !MOUNT.test(approleMount))
    throw new PluginError("INVALID_FIELD", "The KV mount or AppRole mount name is not valid.");
  if (prefix && !(safePath(prefix) && /^[A-Za-z0-9._/-]+$/.test(prefix)))
    throw new PluginError("INVALID_FIELD", "The folder to share from is not valid.");
  const mode = pickMode<"token" | "approle">("OpenBao", c.config, {
    token: ["token"],
    approle: ["roleId", "secretId"],
  });
  const account = createHash("sha256")
    .update(
      [
        c.userId,
        base,
        namespace,
        c.config.roleId ?? "",
        c.config.secretId ?? "",
        approleMount,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 32);

  /** One HTTP call. `token` null means unauthenticated (AppRole login). A 404 returns undefined so callers can tell "nothing there". */
  async function call(
    method: "GET" | "POST",
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    if (!(await vaultAllowsPrivate())) {
      await assertPublicUrl(base).catch(() => {
        throw new PluginError(
          "BLOCKED_URL",
          "That OpenBao server address is not allowed (private addresses must be enabled by the administrator).",
        );
      });
      // Over plain http the token would cross the internet unprotected; only a private network may use it.
      if (!base.startsWith("https://"))
        throw new PluginError(
          "INVALID_FIELD",
          "The OpenBao server address must start with https://.",
          "Plain http is accepted only for a server on a private network, which the administrator must enable.",
        );
    }
    let res: Response;
    try {
      res = await vaultFetch(`${base}/v1/${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { "X-Vault-Token": token } : {}),
          ...(namespace ? { "X-Vault-Namespace": namespace } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PluginError(
        "UNREACHABLE",
        "The OpenBao server could not be reached.",
        "Check the server address, the certificate (a private CA needs NODE_EXTRA_CA_CERTS on the Zetta server) and that it is running.",
      );
    }
    if (res.status === 404) return undefined;
    if (res.status === 400 && !token)
      throw new PluginError(
        "AUTH",
        "OpenBao rejected the AppRole role id or secret id.",
        "Check them (and the AppRole mount name), then remove and install the OpenBao plugin again.",
      );
    if (res.status === 401 || res.status === 403)
      throw new PluginError(
        "AUTH",
        "OpenBao refused the credentials, or their policy does not allow that path.",
        "Check the token (or AppRole), and give its policy read and list access to the KV mount.",
      );
    if (res.status === 429 || res.status >= 500)
      throw new PluginError(
        "VAULT_ERROR",
        `The OpenBao server answered HTTP ${res.status}.`,
        "Check that the server is unsealed and healthy, then try again.",
      );
    if (!res.ok)
      throw new PluginError("VAULT_ERROR", `The OpenBao server answered HTTP ${res.status}.`);
    const text = await res.text();
    if (text.length > MAX_BODY)
      throw new PluginError("TOO_LARGE", "OpenBao answered with too much data.");
    return text.trim() ? json<Record<string, unknown>>(text, "OpenBao") : {};
  }

  async function login(): Promise<string> {
    const hit = tokens.get(account);
    if (hit && hit.until > Date.now()) return hit.token;
    const r = await call("POST", `auth/${approleMount}/login`, null, {
      role_id: c.config.roleId!.trim(),
      secret_id: c.config.secretId!.trim(),
    });
    const auth = asRecord(r?.auth);
    const token = typeof auth.client_token === "string" ? auth.client_token : "";
    if (!token)
      throw new PluginError(
        "AUTH",
        "OpenBao did not return a token for that AppRole.",
        "Check the AppRole mount name and that the role can log in.",
      );
    const ttl = Number(auth.lease_duration) > 0 ? Number(auth.lease_duration) : TOKEN_FALLBACK_S;
    tokens.set(account, { token, until: Date.now() + Math.max(ttl - 30, 10) * 1000 });
    return token;
  }
  const tokenNow = async () => (mode === "token" ? c.config.token!.trim() : login());
  /** An authenticated call; an AppRole token that stopped working is replaced once. */
  async function authed(method: "GET" | "POST", path: string) {
    try {
      return await call(method, path, await tokenNow());
    } catch (e) {
      if (
        mode === "approle" &&
        e instanceof PluginError &&
        e.code === "AUTH" &&
        tokens.has(account)
      ) {
        tokens.delete(account);
        return call(method, path, await tokenNow());
      }
      throw e;
    }
  }

  /** KV version of the mount: asked from the server once (10 minutes), version 2 when it cannot be told (a policy may hide the mount's metadata). */
  async function config(): Promise<Cfg> {
    const key = `${account}\u0000${mount}`,
      hit = mounts.get(key);
    let version: 1 | 2 = hit && hit.until > Date.now() ? hit.version : 2;
    if (!hit || hit.until <= Date.now()) {
      // A mount that cannot be described (a policy hides it) is taken as version 2.
      const r = await authed("GET", `sys/internal/ui/mounts/${enc(mount)}`).catch((e) => {
        if (e instanceof PluginError && e.code === "AUTH") return undefined;
        throw e;
      });
      version = r && String(asRecord(asRecord(r.data).options).version ?? "") !== "2" ? 1 : 2;
      mounts.set(key, { version, until: Date.now() + MOUNT_TTL_MS });
    }
    return { mount, prefix, version };
  }

  const dataPath = (k: Cfg, id: string) =>
    k.version === 2 ? `${k.mount}/data/${enc(id)}` : `${k.mount}/${enc(id)}`;
  async function read(k: Cfg, id: string): Promise<Secret | undefined> {
    const r = await authed("GET", dataPath(k, id));
    if (!r) return undefined;
    const d = asRecord(r.data);
    return k.version === 2
      ? { data: asRecord(d.data), meta: asRecord(asRecord(d.metadata).custom_metadata) }
      : { data: d, meta: {} };
  }
  const underPrefix = (k: Cfg, id: string) =>
    !k.prefix || id === k.prefix || id.startsWith(`${k.prefix}/`);
  /** Secret paths under the prefix (the listing returns names only, folders end with a slash). */
  async function paths(k: Cfg): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string, depth: number) {
      const r = await authed(
        "GET",
        `${k.mount}/${k.version === 2 ? "metadata/" : ""}${dir ? `${enc(dir)}/` : ""}?list=true`,
      );
      const keys = asRecord(r?.data).keys;
      for (const name of Array.isArray(keys) ? keys.slice(0, MAX_ITEMS) : []) {
        if (out.length >= MAX_ITEMS || typeof name !== "string") return;
        const full = dir ? `${dir}/${name}` : name;
        if (name.endsWith("/")) {
          if (depth < MAX_DEPTH && safePath(full.slice(0, -1)))
            await walk(full.slice(0, -1), depth + 1);
        } else if (safePath(full)) out.push(full);
      }
    }
    await walk(k.prefix, 0);
    return out;
  }
  const idOk = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(id) && safePath(id);

  const adapter: VaultAdapter = {
    mode,
    cli: {
      "bao secrets list": async () => {
        const r = await authed("GET", "sys/internal/ui/mounts");
        const secret = asRecord(asRecord(r?.data).secret);
        return named(
          Object.entries(secret).map(([path, v]) => ({
            id: path,
            name: String(asRecord(v).type ?? ""),
          })),
        );
      },
      "bao kv list": () => itemRows(adapter),
    },
    async probe() {
      if (mode === "token") await call("GET", "auth/token/lookup-self", c.config.token!.trim());
      else {
        tokens.delete(account); // the check must prove the role id and secret id, not an earlier token
        await login();
      }
    },
    async list() {
      const k = await config(),
        ids = (await paths(k)).filter(idOk),
        out: VaultItem[] = [];
      // Values are read to learn which fields exist and the sites; only that metadata is kept.
      for (let i = 0; i < ids.length; i += PARALLEL)
        await Promise.all(
          ids.slice(i, i + PARALLEL).map(async (id) => {
            const s = await read(k, id);
            if (!s) return;
            const fields = fieldsOf(s.data);
            if (!fields.length) return;
            out.push({
              id,
              title: clean(id, 120),
              urls: [...new Set([...sitesOf(s.meta), ...sitesOf(s.data)])]
                .map((u) => clean(u, 300))
                .filter(Boolean)
                .slice(0, 10),
              fields,
            });
          }),
        );
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },
    async reveal(id, field) {
      if (!idOk(id))
        throw new PluginError("INVALID_ARGS", "That OpenBao secret path is not valid.");
      const k = await config();
      if (!underPrefix(k, id))
        throw new PluginError(
          "ITEM_NOT_FOUND",
          "That secret is outside the folder shared from OpenBao.",
        );
      const s = await read(k, id);
      if (!s)
        throw new PluginError(
          "ITEM_NOT_FOUND",
          "OpenBao could not find that secret, or the credentials cannot read it.",
          "It may have been deleted or moved; share it again in Studio > Plugins > OpenBao.",
        );
      const v = valueOf(s.data, KEYS[field]);
      if (field !== "totp") return v;
      try {
        return v ? totp(v) : "";
      } catch {
        return "";
      }
    },
  };
  return adapter;
}

export const OPENBAO = registerPlugin(
  vaultPlugin({
    id: "openbao",
    name: "OpenBao",
    icon: "key-round",
    docsUrl: "https://openbao.org/docs/",
    description:
      "Let bots sign in to websites with logins you share from your OpenBao (or HashiCorp Vault) server. Bots never see the passwords: Zetta types them on the right site.",
    notes:
      "Connect your own server with a token or an AppRole (role id and secret id), preferably with a policy that can only read one KV folder. Each secret is one login: keys username, password and totp (a base32 seed or otpauth:// link); a url, website or sites key (or custom metadata) gives its default sites. KV versions 1 and 2. Nothing is shared until you pick logins under Shared logins.",
    fields: [
      {
        key: "baseUrl",
        label: "Server URL",
        kind: "url",
        placeholder: "https://bao.example.com:8200",
        help: "Your OpenBao server. A private CA needs NODE_EXTRA_CA_CERTS on the Zetta server.",
      },
      {
        key: "token",
        label: "Token",
        secret: true,
        optional: true,
        kind: "password",
        placeholder: "s....",
        help: "Option 1: a token with read and list access. Leave the AppRole fields empty.",
      },
      {
        key: "roleId",
        label: "AppRole role id",
        optional: true,
        help: "Option 2. Leave the token empty.",
      },
      {
        key: "secretId",
        label: "AppRole secret id",
        secret: true,
        optional: true,
        kind: "password",
        help: "Option 2.",
      },
      {
        key: "approleMount",
        label: "AppRole mount",
        optional: true,
        placeholder: "approle",
        help: "Only when the AppRole auth method is mounted under another name.",
      },
      {
        key: "namespace",
        label: "Namespace",
        optional: true,
        placeholder: "team1",
        help: "Leave empty unless the server uses namespaces.",
      },
      {
        key: "mount",
        label: "KV mount",
        optional: true,
        placeholder: "secret",
        help: "The KV secrets engine that holds the logins. Empty means secret.",
      },
      {
        key: "prefix",
        label: "Folder",
        optional: true,
        placeholder: "websites",
        help: "Only offer secrets under this folder of the mount. Empty means the whole mount.",
      },
    ],
    cliCommands: ["bao secrets list", "bao kv list"],
    adapter: openbao,
  }),
);
