import { AVATAR_ART_VERSION, parseColorQuery, renderPresetSvg } from "@zetta/core/avatar-art";
import { Elysia } from "elysia";
import { z } from "zod";
import { accessFail, fail } from "../http-response";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { decodeImage } from "./out";
import type { AvatarStore } from "./store";

export type AvatarServices = {
  access: ReturnType<typeof createIdentityAccess>;
  avatars: AvatarStore;
};

const uuid = z.string().uuid();
/** A person's id is the auth library's text id, not a uuid. */
const personId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const IMMUTABLE = "max-age=31536000, immutable";

function mapError(e: unknown) {
  if (e instanceof AccessError) return accessFail(e);
  if (e instanceof z.ZodError) return fail(404, "NOT_FOUND", "That picture is not available.");
  return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
}

/**
 * A preset picture is a file of its own: `/api/avatars/preset/<id>.svg?c=<hex-hex-hex>&v=<art version>`. It holds nothing private (a
 * template and a few colors), so it needs no sign-in, and a year of caching is safe because the version is part of the URL.
 *
 * An uploaded picture is `/api/avatars/{bot|user}/<id>?v=<hash>`: the bytes of the stored image. It is public to the organization: any
 * signed-in member may load the picture of any bot or person, whoever owns it. It is cached by the browser for a year because a new
 * picture has a new hash.
 */
export function createAvatarRoutes(services?: AvatarServices): Elysia {
  const app = new Elysia({ prefix: "/api/avatars", normalize: false }).get(
    "/preset/:file",
    ({ params, query }) => {
      const m = /^([a-z0-9-]{1,32})\.svg$/.exec(params.file);
      const colors = query.c === undefined ? [] : parseColorQuery(query.c);
      if (!m || colors === null)
        return fail(400, "INVALID_REQUEST", "That picture is not available.");
      const svg = renderPresetSvg(m[1]!, colors);
      if (svg === null) return fail(404, "NOT_FOUND", "That picture is not available.");
      return new Response(svg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          // The URL names a look and a version, so the same URL is always the same bytes. A request without `v` (a hand-typed link) is not cached for long.
          "cache-control":
            query.v === String(AVATAR_ART_VERSION)
              ? `public, ${IMMUTABLE}`
              : "public, max-age=3600",
        },
      });
    },
  );
  if (!services) return app as unknown as Elysia;
  const { access, avatars } = services;

  const image = (stored: unknown) => {
    const decoded = decodeImage(stored);
    if (!decoded) return fail(404, "NOT_FOUND", "That picture is not available.");
    return new Response(decoded.bytes, {
      headers: {
        "content-type": decoded.mime,
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": `private, ${IMMUTABLE}`,
      },
    });
  };
  return app
    .get("/bot/:id", async ({ request, params }) => {
      try {
        const actor = await access.requireActive(request.headers);
        return image(await avatars.bot(actor, uuid.parse(params.id)));
      } catch (error) {
        return mapError(error);
      }
    })
    .get("/user/:id", async ({ request, params }) => {
      try {
        const actor = await access.requireActive(request.headers);
        return image(await avatars.user(actor, personId.parse(params.id)));
      } catch (error) {
        return mapError(error);
      }
    }) as unknown as Elysia;
}
