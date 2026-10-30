/**
 * What a bot-written HTML page may load and do. The page is sandboxed without same-origin (no cookies, no API), and this policy also
 * closes the network from inside it: no fetch/XHR/WebSocket (`connect-src`), no form posts, no remote images (a request URL can carry
 * data), no frames. Scripts and styles may come from the public CDNs bots use for chart and UI libraries.
 * A page can still navigate itself to a URL; a sandbox cannot stop that, so a page must never hold data its viewer should not see.
 */
const CDNS = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
export const ARTIFACT_HTML_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS}`,
  `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
  `font-src data: ${CDNS} https://fonts.gstatic.com`,
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");
/** Sandbox flags for the served page and the preview iframe: scripts and links in new tabs, never forms or same-origin. */
export const ARTIFACT_HTML_SANDBOX = "allow-scripts allow-popups";
