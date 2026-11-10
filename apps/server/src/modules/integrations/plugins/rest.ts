import { PluginError } from "./registry";

/**
 * One HTTP call to a fixed vendor API for the API-key plugins (Trello, ElevenLabs, Vercel, Supabase, Canva). The base address is the
 * plugin's own constant, never a user value, so there is no SSRF surface; redirects are never followed, so a key is only ever sent to
 * that address. Status codes become PluginErrors written for a person.
 */
export type RestCall = {
  service: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** "json" (default) parses the answer; "bytes" returns it raw (audio, exports). */
  as?: "json" | "bytes";
  timeoutMs?: number;
  /** The setting to fix when the key is refused. */
  keyHint: string;
};

const MAX_BODY = 4_000_000;

export async function rest(c: RestCall & { as: "bytes" }): Promise<Uint8Array>;
export async function rest(c: RestCall): Promise<unknown>;
export async function rest(c: RestCall): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json", ...c.headers };
  if (c.body !== undefined && !(c.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(c.url, {
      method: c.method ?? "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(c.timeoutMs ?? 20_000),
      body:
        c.body === undefined
          ? undefined
          : c.body instanceof FormData
            ? c.body
            : JSON.stringify(c.body),
    });
  } catch {
    throw new PluginError(
      "UNREACHABLE",
      `${c.service} could not be reached.`,
      "Try again in a moment.",
    );
  }
  if (res.status === 401 || res.status === 403)
    throw new PluginError("NEEDS_AUTH", `${c.service} refused the key.`, c.keyHint);
  if (res.status === 404)
    throw new PluginError("NOT_FOUND", `${c.service} found nothing with that id.`);
  if (res.status === 429)
    throw new PluginError(
      "RATE_LIMITED",
      `${c.service} says too many requests.`,
      "Wait a minute and try again.",
    );
  if (res.status >= 300) {
    const detail = (await res.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    throw new PluginError(
      "SERVICE_ERROR",
      `${c.service} answered ${res.status}${detail ? `: ${detail}` : ""}.`,
    );
  }
  if (c.as === "bytes") {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 20_000_000)
      throw new PluginError("TOO_LARGE", `${c.service} sent too much data.`);
    return buf;
  }
  const text = await res.text();
  if (text.length > MAX_BODY)
    throw new PluginError("TOO_LARGE", `${c.service} sent too much data.`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new PluginError("SERVICE_ERROR", `${c.service} answered with something unexpected.`);
  }
}

/** A required string argument, trimmed and bounded. */
export function str(args: Record<string, unknown>, key: string, max = 2000): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new PluginError("INVALID_ARGS", `"${key}" is required (text up to ${max} characters).`);
  return v.trim();
}
export function optStr(args: Record<string, unknown>, key: string, max = 2000): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  return str(args, key, max);
}
/** An id the vendor gave out: letters, digits, dash and underscore only, so it is safe in a path. */
export function id(args: Record<string, unknown>, key: string): string {
  const v = str(args, key, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(v))
    throw new PluginError("INVALID_ARGS", `"${key}" is not a valid id.`);
  return v;
}
