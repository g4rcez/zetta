/**
 * What a client (the desktop app, later the phone app) learns about a Zetta server before it signs in.
 * The server answers it at `GET /api/meta`. The web build also ships `/.well-known/zetta.json` with the API origin it was built for, so a
 * client that is given the address of the web UI (served by nginx, with no API) can find the API and ask it for the rest.
 *
 * `protocol` counts breaking changes of this contract and of the native bridge. A client refuses a server whose protocol is newer than it knows.
 */
export const SERVER_PROTOCOL = 1;

export type ServerMeta = {
  name: "zetta";
  protocol: number;
  /** Where people open the web UI. Cookies and OAuth redirects are tied to it. */
  webOrigin: string;
  /** Where the API answers. Equal to `webOrigin` when the server also serves the web UI. */
  apiOrigin: string;
};

/** The origin (`scheme://host[:port]`) of an http(s) address, or null for anything else (`javascript:`, `file:`, `views:`, garbage). */
export function normalizeOrigin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Validates a `/api/meta` or `zetta.json` body. Returns null when it is not a Zetta server this client can talk to. */
export function parseServerMeta(value: unknown): ServerMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (body.name !== "zetta") return null;
  if (typeof body.protocol !== "number" || !Number.isInteger(body.protocol) || body.protocol < 1)
    return null;
  if (body.protocol > SERVER_PROTOCOL) return null;
  const webOrigin = normalizeOrigin(body.webOrigin);
  const apiOrigin = normalizeOrigin(body.apiOrigin);
  if (!webOrigin || !apiOrigin) return null;
  return { name: "zetta", protocol: body.protocol, webOrigin, apiOrigin };
}

export const buildServerMeta = (webOrigin: string, apiOrigin: string): ServerMeta => ({
  name: "zetta",
  protocol: SERVER_PROTOCOL,
  webOrigin,
  apiOrigin,
});

/** The body of `/.well-known/zetta.json`, written by the web build. It cannot know the origin it will be served from, only the API it was built for. */
export type WellKnown = { name: "zetta"; protocol: number; apiOrigin: string };

export const buildWellKnown = (apiOrigin: string): WellKnown => ({
  name: "zetta",
  protocol: SERVER_PROTOCOL,
  apiOrigin,
});

export function parseWellKnown(value: unknown): WellKnown | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (body.name !== "zetta") return null;
  if (typeof body.protocol !== "number" || !Number.isInteger(body.protocol) || body.protocol < 1)
    return null;
  if (body.protocol > SERVER_PROTOCOL) return null;
  const apiOrigin = normalizeOrigin(body.apiOrigin);
  return apiOrigin ? { name: "zetta", protocol: body.protocol, apiOrigin } : null;
}
