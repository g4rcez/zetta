/**
 * A model on the person's own server (Ollama, vLLM, LM Studio, llama.cpp, any OpenAI-compatible server). It is a `connection` of provider
 * `compatible`: the sealed secret is the optional API key, and the non-secret settings (address, model name) are the `config_base_url` and `config_model` columns of `connection`.
 * See docs/decisions/feedback-wave2-foundation.md.
 *
 * This file also holds the address rule. It is pure (no DNS, no I/O) so the web form, the server route and the engine setup apply the
 * same words. A name that is not an IP address must be resolved by the caller, and every resolved address passes `resolvedAddressIssue`.
 *
 * Only erasable syntax here: the database schema, the server and the web app all import this file.
 */

export const COMPATIBLE_PROVIDER = "compatible";
/**
 * The transport purpose the browser seals the key to: the same name every connection uses (`connection.create:<provider>`). The sealed
 * body holds only `{ secret }`; the address and model name travel beside it, in plain text, because they are not secret.
 */
export const COMPATIBLE_KEY_PURPOSE = "connection.create:compatible";
/** Non-secret settings of a connection of provider `compatible`. */
export type CompatibleConfig = { baseUrl: string; model: string };
/** Longest values (the config as a whole is also capped by a CHECK in the database). */
export const COMPATIBLE_LIMITS = { baseUrl: 512, model: 100, label: 100 } as const;
/** A model name is the server's own: `llama3.1:8b`, `hf.co/org/model:Q4_K_M`, `qwen2.5-coder`. */
export const COMPATIBLE_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
/**
 * A connection always holds a sealed secret. A server with no key (Ollama's default) is saved with this placeholder, which the engine
 * setup treats as "no key": it is never sent as a credential to a server the person did not give a key for, and it is not a secret.
 */
export const COMPATIBLE_NO_KEY = "no-key";

/** The key to send to the server, or null when the connection holds the no-key placeholder (send no credential at all). */
export const compatibleKey = (secret: string): string | null =>
  secret === "" || secret === COMPATIBLE_NO_KEY ? null : secret;

/**
 * - `public`: a public IP address. `loopback`: this machine. `private`: the local network (RFC 1918, shared address space, unique-local).
 * - `blocked`: never allowed for anyone: cloud metadata, link-local, unspecified, multicast and reserved ranges.
 */
export type AddressClass = "public" | "loopback" | "private" | "blocked";

type V4 = readonly [number, number, number, number];
const v4Parts = (ip: string): V4 | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const;
  return parts.every((n) => n <= 255) ? parts : null;
};

function classifyV4([a, b, c, d]: V4): AddressClass {
  if (a === 127) return "loopback";
  // The metadata address of Alibaba Cloud sits inside the shared address space Tailscale and carrier NAT use: it is the one exception.
  if (a === 100 && b === 100 && c === 100 && d === 200) return "blocked";
  if (a === 0 || a >= 224) return "blocked";
  if (a === 169 && b === 254) return "blocked";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  return "public";
}

/** Eight 16-bit groups of an IPv6 address, or null when it is not one. Accepts `::` and a dotted IPv4 tail. */
function v6Groups(raw: string): number[] | null {
  let ip = raw.toLowerCase();
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  const tail = ip.lastIndexOf(":");
  if (tail >= 0 && ip.includes(".", tail)) {
    const v4 = v4Parts(ip.slice(tail + 1));
    if (!v4) return null;
    ip = `${ip.slice(0, tail + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

/** The class of an IP address (v4 or v6). Anything that is not an IP address is `blocked`, so a caller cannot forget to check. */
export function classifyIp(raw: string): AddressClass {
  const ip = raw.replace(/^\[|\]$/g, "");
  const v4 = v4Parts(ip);
  if (v4) return classifyV4(v4);
  const g = v6Groups(ip);
  if (!g) return "blocked";
  const embedded = (hi: number, lo: number) => classifyV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zeros5 = g.slice(0, 5).every((x) => x === 0);
  if (zeros5 && g[5] === 0xffff) return embedded(g[6]!, g[7]!); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return embedded(g[6]!, g[7]!); // 64:ff9b::/96 (NAT64)
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  if (g.slice(0, 7).every((x) => x === 0)) return g[7] === 1 ? "loopback" : "blocked"; // ::1, ::, ::a.b.c.d
  if ((g[0]! & 0xffc0) === 0xfe80) return "blocked"; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return "blocked"; // multicast
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g[7] === 0x254) return "blocked"; // AWS IPv6 metadata
  if ((g[0]! & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique-local
  return "public";
}

/**
 * Whether the address a name resolved to may be used. A caller that resolves a name runs every address it got through this; one
 * blocked or (without `allowLocal`) local address refuses the lot, so a name cannot hide a private address behind a public one.
 */
export function resolvedAddressIssue(
  ips: readonly string[],
  o: { allowLocal: boolean },
): ModelAddressIssue | null {
  if (ips.length === 0) return "unresolvable";
  for (const ip of ips) {
    const c = classifyIp(ip);
    if (c === "blocked") return "blocked_address";
    if ((c === "loopback" || c === "private") && !o.allowLocal) return "local_not_allowed";
  }
  return null;
}

export type ModelAddressIssue =
  | "not_a_url"
  | "too_long"
  | "scheme"
  | "credentials"
  | "query_or_fragment"
  | "blocked_address"
  | "local_not_allowed"
  | "insecure_public"
  | "unresolvable";

/** What `checkModelAddress` found out about the host. `name`: a public-looking name, which the caller must resolve and check. */
export type HostKind = AddressClass | "name";

const METADATA_NAMES = ["metadata", "metadata.google.internal", "instance-data"];
/** Names that only resolve on the machine or its network: no dot at all (a container or LAN name), or a local-network suffix. */
const LOCAL_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa", ".localdomain", ".intranet"];

function classifyHost(host: string): HostKind {
  if (METADATA_NAMES.includes(host)) return "blocked";
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host.startsWith("[") || v4Parts(host)) return classifyIp(host);
  if (!host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return "private";
  return "name";
}

/**
 * The address rule of a model server.
 *
 * - Only `http` and `https`; no user name, password, query or fragment; at most 512 characters.
 * - Never allowed, for anyone: cloud metadata (169.254.0.0/16, `fd00:ec2::254`, 100.100.100.200, `metadata.google.internal`), link-local,
 *   unspecified, multicast and reserved addresses.
 * - Loopback and the local network (`localhost`, 127.0.0.1, 192.168.x.x, 10.x.x.x, a Tailscale 100.64/10 address, a one-word host name
 *   such as `ollama`) are allowed only with `allowLocal`: the owner of the server (an administrator) or an operator who set
 *   ZETTA_ALLOW_PRIVATE_NETWORK=1. A member of somebody else's server must not point the server at its own network.
 * - `http` is allowed only to a local address, where the traffic never leaves the network. A public host needs `https`, because the
 *   key and the conversation travel to it.
 *
 * Returns the address without a trailing slash. `hostKind` `name` means the host is a public-looking name: resolve it and pass every
 * address to `resolvedAddressIssue` before the first call, and again for every call (a name can change what it points to).
 */
export function checkModelAddress(
  raw: string,
  o: { allowLocal: boolean },
): { ok: true; baseUrl: string; hostKind: HostKind } | { ok: false; issue: ModelAddressIssue } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length > COMPATIBLE_LIMITS.baseUrl) return { ok: false, issue: "too_long" };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, issue: "not_a_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, issue: "scheme" };
  if (u.username || u.password) return { ok: false, issue: "credentials" };
  if (u.search || u.hash || text.endsWith("?") || text.endsWith("#"))
    return { ok: false, issue: "query_or_fragment" };
  const hostKind = classifyHost(u.hostname.toLowerCase());
  if (hostKind === "blocked") return { ok: false, issue: "blocked_address" };
  const local = hostKind === "loopback" || hostKind === "private";
  if (local && !o.allowLocal) return { ok: false, issue: "local_not_allowed" };
  if (!local && u.protocol === "http:") return { ok: false, issue: "insecure_public" };
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, baseUrl: `${u.origin}${path}`, hostKind };
}

/** Whether a person may point the server at its own machine or network: its owner, or when the operator opened it for everyone. */
export const allowLocalModelServer = (o: { isAdmin: boolean; operatorAllowsPrivate: boolean }) =>
  o.isAdmin || o.operatorAllowsPrivate;

export type CompatibleConfigIssue =
  | { field: "baseUrl"; issue: ModelAddressIssue }
  | { field: "model"; issue: "model_invalid" }
  | { field: "config"; issue: "config_invalid" };

/** Reads the config of a `compatible` connection (from a form, or from the database at the moment of use) and applies the address rule. */
export function parseCompatibleConfig(
  input: unknown,
  o: { allowLocal: boolean },
):
  | { ok: true; config: CompatibleConfig; hostKind: HostKind }
  | { ok: false; error: CompatibleConfigIssue } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, error: { field: "config", issue: "config_invalid" } };
  const { baseUrl, model } = input as Record<string, unknown>;
  if (typeof baseUrl !== "string" || typeof model !== "string")
    return { ok: false, error: { field: "config", issue: "config_invalid" } };
  const address = checkModelAddress(baseUrl, o);
  if (!address.ok) return { ok: false, error: { field: "baseUrl", issue: address.issue } };
  const name = model.trim();
  if (name.length > COMPATIBLE_LIMITS.model || !COMPATIBLE_MODEL_PATTERN.test(name))
    return { ok: false, error: { field: "model", issue: "model_invalid" } };
  return {
    ok: true,
    config: { baseUrl: address.baseUrl, model: name },
    hostKind: address.hostKind,
  };
}

/** A sentence for each issue, for the form and the error the owner reads. */
export const MODEL_ADDRESS_MESSAGES: Record<ModelAddressIssue, string> = {
  not_a_url: "That is not a web address. Write it like http://127.0.0.1:11434/v1.",
  too_long: "The address is too long.",
  scheme: "The address must start with http:// or https://.",
  credentials: "Give the address without a user name or password. Use the key field.",
  query_or_fragment: "Give the address without anything after a ? or a #.",
  blocked_address: "That address is not allowed: it is a cloud metadata or reserved address.",
  local_not_allowed:
    "A server on this machine or its network can only be added by an administrator, or when the operator allows private addresses.",
  insecure_public:
    "A server on the internet must use https://, because your key and chat travel to it.",
  unresolvable: "That address does not resolve to a server.",
};
