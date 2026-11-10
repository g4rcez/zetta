import {
  normalizeOrigin,
  parseServerMeta,
  parseWellKnown,
  SERVER_PROTOCOL,
  type ServerMeta,
} from "@zetta/core/server-meta";

export type DiscoverResult =
  | { status: "found"; meta: ServerMeta }
  | { status: "invalid-address" | "unreachable" | "not-zetta" | "newer-protocol" };

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const loopback = /^(localhost|127(\.\d+){3}|\[::1\])(:\d+)?(\/|$)/i;

/** What someone typed into "add a server": a bare host gets https (http for this computer), and anything else must already be http(s). */
export function addressToOrigin(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return normalizeOrigin(text);
  return normalizeOrigin(`${loopback.test(text) ? "http" : "https"}://${text}`);
}

async function getJson(
  url: string,
  fetcher: FetchLike,
  timeoutMs: number,
): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const needsNewerApp = (body: unknown) =>
  typeof body === "object" &&
  body !== null &&
  (body as { name?: unknown }).name === "zetta" &&
  Number((body as { protocol?: unknown }).protocol) > SERVER_PROTOCOL;

/**
 * Finds out whether an address is a Zetta server this app can talk to.
 * 1. `<address>/api/meta`: the address is the API, or a server that serves both.
 * 2. `<address>/.well-known/zetta.json`: the address is a web UI served on its own; it names the API, which is then asked for `/api/meta`.
 * The address someone typed must be one of the two origins the server reports. Otherwise a server could send this app to a site of its choice
 * while the person believes they are adding the address they typed.
 */
export async function discoverServer(
  input: string,
  fetcher: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 5_000,
): Promise<DiscoverResult> {
  const origin = addressToOrigin(input);
  if (!origin) return { status: "invalid-address" };

  let answered = false;
  let newer = false;
  const ask = async (url: string) => {
    const body = await getJson(url, fetcher, timeoutMs);
    if (body !== undefined) answered = true;
    if (needsNewerApp(body)) newer = true;
    return body;
  };
  const accept = (meta: ServerMeta | null): DiscoverResult | null =>
    meta && (meta.webOrigin === origin || meta.apiOrigin === origin)
      ? { status: "found", meta }
      : null;

  const direct = accept(parseServerMeta(await ask(`${origin}/api/meta`)));
  if (direct) return direct;

  const wellKnown = parseWellKnown(await ask(`${origin}/.well-known/zetta.json`));
  if (wellKnown) {
    const viaApi = accept(parseServerMeta(await ask(`${wellKnown.apiOrigin}/api/meta`)));
    if (viaApi) return viaApi;
  }

  if (newer) return { status: "newer-protocol" };
  return { status: answered ? "not-zetta" : "unreachable" };
}
