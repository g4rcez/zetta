import { AccessError } from "../../../identity/access";
import { PluginError } from "../registry";
import { b64u, sha } from "../oauth2";

/**
 * The loopback listener of a Google "Desktop app" sign-in. Google redirects the browser to http://127.0.0.1:<port>/?state=…&code=…; when the
 * browser runs on the same computer as the server, this listener is what answers, finishes the exchange and sends the browser back to the
 * plugin page. On any other setup (another device, Docker, a remote server) 127.0.0.1 is not this process, the page does not load and the
 * user pastes the address instead (POST /api/plugins/google/complete).
 *
 * The one unauthenticated path of the plugin, so it is narrow: 127.0.0.1 only, GET / only, and only a `state` this process issued
 * (256-bit, single use, ten minutes, looked up by its hash). The user comes from the registry written at connect time, never from the
 * request. The redirect target comes from configuration, so nothing in the request is reflected.
 */
export type LoopbackConfig = {
  /** Finishes the sign-in as `userId` with a fresh plugin context (the services wiring: background actor + mcp.plugins.callback). */
  complete(userId: string, params: URLSearchParams): Promise<void>;
  /** The web origin the browser returns to (ZETTA_SERVER_URL). */
  webOrigin: string;
};

type Held = { userId: string; exp: number };
type Handle = { server: ReturnType<typeof Bun.serve>; port: number };
type Slot = { zettaGoogleLoopback?: Handle };
const slot = globalThis as unknown as Slot;
// A hot reload of this module must not leave the old listener holding the port.
slot.zettaGoogleLoopback?.server.stop(true);
slot.zettaGoogleLoopback = undefined;

let config: LoopbackConfig | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const held = new Map<string, Held>();

/** Wired once by the services (the plugin has no access to actors). Without it there is no listener and the paste step is the only way. */
export const configureGoogleLoopback = (c: LoopbackConfig | undefined) => {
  config = c;
};

/** Graceful by default: the last answer (the redirect back to the plugin page) may still be on its way out. */
export function stopLoopback(force = false) {
  clearTimeout(timer);
  timer = undefined;
  slot.zettaGoogleLoopback?.server.stop(force);
  slot.zettaGoogleLoopback = undefined;
}
/** Test hook: stop the listener and forget every pending sign-in. */
export function resetLoopback() {
  held.clear();
  stopLoopback(true);
  config = undefined;
}

function prune(now: number) {
  for (const [k, v] of held) if (v.exp <= now) held.delete(k);
  if (!held.size) stopLoopback();
}

function backTo(webOrigin: string, ok: boolean, reason?: string) {
  const query = `plugin=google&status=${ok ? "ok" : "error"}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;
  return new Response(null, {
    status: 303,
    headers: {
      location: `${webOrigin.replace(/\/+$/, "")}/plugins/google?${query}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
  });

async function handle(request: Request, now: () => number): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/" || !config) return notFound();
  const state = url.searchParams.get("state") ?? "";
  const key = b64u(sha(state));
  const entry = state ? held.get(key) : undefined;
  if (!entry || entry.exp <= now()) return notFound();
  held.delete(key); // single use
  try {
    await config.complete(entry.userId, url.searchParams);
    return backTo(config.webOrigin, true);
  } catch (e) {
    return backTo(
      config.webOrigin,
      false,
      e instanceof PluginError || e instanceof AccessError ? e.code : "UNAVAILABLE",
    );
  } finally {
    prune(now());
  }
}

/**
 * Remembers a sign-in that is waiting for Google's redirect and makes sure the listener is up. Returns the port the listener is bound to, or
 * null when there is none (not configured, or the port is taken): the caller then still builds the same redirect and the user pastes it.
 */
export async function expectRedirect(
  stateHash: string,
  userId: string,
  exp: number,
  port: number,
  now: () => number,
): Promise<number | null> {
  if (!config) return null;
  if (!slot.zettaGoogleLoopback) {
    try {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: (request) => handle(request, now),
      });
      slot.zettaGoogleLoopback = { server, port: server.port ?? port };
    } catch (e) {
      console.warn(
        `google: loopback listener not started on 127.0.0.1:${port} (${e instanceof Error ? e.message : "error"}); the sign-in address is pasted instead`,
      );
      return null;
    }
  }
  held.set(stateHash, { userId, exp });
  clearTimeout(timer);
  timer = setTimeout(() => prune(now()), Math.max(1000, exp - now() + 1000));
  timer.unref?.();
  return slot.zettaGoogleLoopback.port;
}
