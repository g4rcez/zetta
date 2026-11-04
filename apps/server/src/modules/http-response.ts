/** JSON responses shared by the route files. No imports on purpose: `app.test.ts` loads routes in a secret-free process. */
export const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const fail = (status: number, code: string, message: string, extra: object = {}) =>
  out({ error: { code, message, ...extra } }, status);

/** The status for an identity error: sign-in 401, missing 404, identity down 503, everything else 403. */
export const accessFail = (e: { code: string; message: string }) =>
  fail(
    e.code === "SIGN_IN_REQUIRED"
      ? 401
      : e.code === "NOT_FOUND"
        ? 404
        : e.code === "IDENTITY_UNAVAILABLE"
          ? 503
          : 403,
    e.code,
    e.message,
  );

/** Writes (every method but GET) must name a trusted origin: this is the CSRF guard. Returns the 403 to send, or nothing. */
export const rejectUntrustedOrigin = (request: Request, trustedOrigins: readonly string[]) => {
  if (request.method === "GET") return undefined;
  const origin = request.headers.get("origin");
  return origin && trustedOrigins.includes(origin)
    ? undefined
    : fail(403, "UNTRUSTED_ORIGIN", "Open Zetta from its trusted application and try again.");
};

type Params = Record<string, string>;
type Query = Record<string, string | undefined>;

/** A route handler for the signed-in person: origin guard, `access.requireActive`, `out(work(...))`, and `mapError` for anything thrown. */
export function createGuardedRoute<Actor>({
  access,
  trustedOrigins,
  mapError,
}: {
  access: { requireActive(headers: Headers): Promise<Actor> };
  trustedOrigins: readonly string[];
  mapError: (e: unknown) => Response;
}) {
  return (
    work: (c: { actor: Actor; body: unknown; params: Params; query: Query }) => Promise<unknown>,
    status = 200,
  ) =>
    async ({
      request,
      body,
      params,
      query,
    }: {
      request: Request;
      body: unknown;
      params: Params;
      query: Query;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        return out(
          await work({ actor: await access.requireActive(request.headers), body, params, query }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };
}
