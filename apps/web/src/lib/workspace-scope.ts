// The workspace this tab works in. It lives in the address (`?w=<slug>`, kept on every link by the root route), so two tabs can work in two
// workspaces and a shared link opens the same one. Every call to the server says which: a header on `fetch`, `?w=` where a header cannot
// be set (an EventSource). The server checks that the person is in it (apps/server/src/modules/workspaces/lookup.ts) and otherwise works
// in their own.

/** A workspace slug as the address carries it. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const WORKSPACE_HEADER = "X-Zetta-Workspace";

/** The slug in an address's `w`, or undefined. */
export function workspaceOf(search: string | URLSearchParams): string | undefined {
  const w = (typeof search === "string" ? new URLSearchParams(search) : search).get("w") ?? "";
  return SLUG.test(w) ? w : undefined;
}

let current: string | undefined =
  typeof location === "undefined" ? undefined : workspaceOf(location.search);

export const workspaceScope = {
  get: () => current,
  /** True when it changed: what was loaded for the other workspace is not this one's. */
  set(slug: string | undefined) {
    const next = slug && SLUG.test(slug) ? slug : undefined;
    if (next === current) return false;
    current = next;
    return true;
  },
};

/** `url` with this tab's workspace, for what cannot carry a header. */
export function withWorkspace(url: URL): URL {
  const next = new URL(url);
  if (current) next.searchParams.set("w", current);
  return next;
}

/**
 * Makes every call to the server's API carry this tab's workspace. Done once, before the app renders: a request already in flight then
 * carries the workspace of the moment it was made.
 */
export function installWorkspaceScope(
  apiOrigin: string,
  target: { fetch: typeof fetch } = globalThis,
) {
  const original = target.fetch.bind(target);
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const slug = current;
    if (!slug) return original(input, init);
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(href, typeof location === "undefined" ? apiOrigin : location.href);
    } catch {
      return original(input, init);
    }
    // The API's own address, or the page's where the web server passes `/api/` on to it.
    const ours =
      url.origin === new URL(apiOrigin).origin ||
      (typeof location !== "undefined" && url.origin === location.origin);
    if (!ours || !url.pathname.startsWith("/api/")) return original(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has(WORKSPACE_HEADER)) headers.set(WORKSPACE_HEADER, slug);
    return original(input, { ...init, headers });
  }) as typeof fetch;
}
