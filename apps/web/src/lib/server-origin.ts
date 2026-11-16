import { ENV } from "../env";

/**
 * The origin the browser calls for `/api`. The web app and the API answer on one origin (the dev server and nginx forward `/api`), so a page
 * opened over http(s) calls the address it was opened on: localhost, a LAN address and a Tailscale address all work with no setting.
 * Without such an origin (the packaged desktop app, a test, server rendering) it is `ZETTA_SERVER_URL`.
 */
export function serverOrigin(): string {
  const page = typeof window === "undefined" ? undefined : window.location;
  return page && /^https?:$/.test(page.protocol) ? page.origin : ENV.ZETTA_SERVER_URL;
}
