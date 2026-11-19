import { createHash, timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { DesktopLinkError, type DesktopLink } from "./service";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * `PUT|DELETE /api/desktop/remotes`: how the desktop app that runs this server links it to the owner's other Zetta server.
 * Never reachable from a browser page or another computer: it needs the link token only the app and this server share (the app made it and
 * started the server with it), and the request must come from this computer. Without the token configured, the routes do not exist.
 */
export function createDesktopLinkRoutes(
  link: DesktopLink,
  token: string,
  /** Where the request came from; tests replace it, since a test calls the app without a socket. */
  peerOf: (
    request: Request,
    server: { requestIP(request: Request): { address: string } | null } | null,
  ) => string | undefined = (request, server) => server?.requestIP(request)?.address,
) {
  const expected = digest(token);
  return new Elysia({ name: "desktop-link", prefix: "/api/desktop" })
    .onBeforeHandle(({ request, server, status }) => {
      const peer = peerOf(request, server as never);
      const given = request.headers.get("x-zetta-desktop-link") ?? "";
      // One compare for every failure: a caller learns nothing about which check it missed.
      if (!peer || !LOOPBACK.has(peer) || !timingSafeEqual(digest(given), expected))
        return status(404);
    })
    .put(
      "/remotes",
      async ({ body, status }) => {
        try {
          return await link.upsert(body);
        } catch (e) {
          if (e instanceof DesktopLinkError)
            return status(e.code === "NOT_READY" ? 409 : 400, { error: e.code });
          throw e;
        }
      },
      {
        body: t.Object({
          origin: t.String({ maxLength: 300 }),
          accessToken: t.String({ maxLength: 8192 }),
        }),
      },
    )
    .delete(
      "/remotes",
      async ({ body, status }) => {
        try {
          return { removed: await link.remove(body.origin) };
        } catch (e) {
          if (e instanceof DesktopLinkError)
            return status(e.code === "NOT_READY" ? 409 : 400, { error: e.code });
          throw e;
        }
      },
      { body: t.Object({ origin: t.String({ maxLength: 300 }) }) },
    );
}
