/**
 * An MCP client (Claude Code, Cursor, …) signs in to Zetta with OAuth. The API sends the browser to /login or /oauth/consent with a
 * query it signed (`sig`); requests made from that page send the query back as `oauth_query`, unchanged, so the API can continue.
 */
export function signedOAuthQuery(search = window.location.search): string | undefined {
  return new URLSearchParams(search).has("sig") ? search.replace(/^\?/, "") : undefined;
}

/** Where the API continues the flow: the consent page (this app) or the client's own callback (outside the app). */
export function isAppUrl(url: string) {
  return new URL(url, window.location.href).origin === window.location.origin;
}
