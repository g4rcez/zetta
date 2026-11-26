// Every request runs with a workspace slot of its own (packages/db/src/tenant.ts). The person's identity fills it in once it is known
// (identity/access.ts, `requireActive`), and from then on everything the request does, including work it leaves running, reads and writes
// that person's workspace.
import { tenant } from "@zetta/db";

type Handler = (request: Request, server?: unknown) => unknown;
const WRAPPED = Symbol("runs in a workspace slot");

/** A workspace slug or id; anything else is ignored. */
const NAMED =
  /^(?:[a-z0-9][a-z0-9-]{0,62}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The workspace a request asks to work in. The web app sends it in a header on every call; an EventSource or a WebSocket, which cannot
 * set one, and an MCP client, whose address is all it is given, put it in the address as `?w=`. Never trusted as such: the identity
 * lookup checks that the person is a member of it.
 */
export function requestedWorkspace(request: Request): string | undefined {
  const named =
    request.headers.get("x-zetta-workspace") ??
    (request.url.includes("w=") ? new URL(request.url).searchParams.get("w") : null);
  return named && NAMED.test(named) ? named : undefined;
}

/**
 * Wraps the app's `fetch`, and wraps it again whenever Elysia compiles the app: `listen` compiles it first and redefines `fetch`, which
 * would drop the wrapper (Elysia's `compile`). Elysia's `handle` (the tests) goes through `fetch` too.
 */
export function withWorkspaces<T extends { fetch: Handler; compile?: () => unknown }>(app: T): T {
  const wrap = () => {
    const handle = app.fetch;
    if ((handle as { [WRAPPED]?: true })[WRAPPED]) return;
    const wrapped = Object.assign(
      (request: Request, server?: unknown) =>
        tenant.open(() => handle.call(app, request, server), requestedWorkspace(request)),
      { [WRAPPED]: true as const },
    );
    Object.defineProperty(app, "fetch", { value: wrapped, configurable: true, writable: true });
  };
  wrap();
  const compile = app.compile?.bind(app);
  if (compile)
    app.compile = () => {
      const compiled = compile();
      wrap();
      return compiled;
    };
  return app;
}
