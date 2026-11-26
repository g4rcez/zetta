import { Elysia } from "elysia";
import { z } from "zod";
import { WORKSPACE_NAME_MAX, WORKSPACE_ROLES } from "@zetta/core/workspace";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import type { Operator } from "./operator";
import { WorkspaceError, type WorkspaceService } from "./service";

export type WorkspaceServices = {
  access: ReturnType<typeof createIdentityAccess>;
  workspaces: WorkspaceService;
  /** Root's view of every workspace (operator.ts). */
  operator?: Operator;
};

const userParam = z.string().min(1).max(128);
const roleInput = z.strictObject({ role: z.enum(WORKSPACE_ROLES) });
const chiefInput = z.strictObject({ botId: z.uuid() });
const joinInput = z.strictObject({ token: z.string().min(1).max(256) });
const limit = z.number().int().min(0).max(100_000_000).nullable();
const quotaInput = z.strictObject({ runsPerMonth: limit, runSecondsPerMonth: limit });
const statusInput = z.strictObject({ status: z.enum(["active", "suspended"]) });
const idParam = z.uuid();
const newInput = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(WORKSPACE_NAME_MAX * 2),
  slug: z.string().min(1).max(80),
  ownerEmail: z.string().min(3).max(320),
});
const nameInput = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(WORKSPACE_NAME_MAX * 2),
});

/**
 * The person's workspace and, for its administrators, its people: roles, invitations waiting, and the Chief shared with a person.
 * Sending and revoking an invitation stay in the identity routes (`/api/identity/invitations`).
 */
// The app factory imports route modules only (app.test.ts): the request wrapper is handed out from here.
export { withWorkspaces } from "./request-context";

export function createWorkspaceRoutes(
  { access, workspaces, operator }: WorkspaceServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof WorkspaceError)
      return e.code === "NOT_FOUND"
        ? fail(404, "NOT_FOUND", e.message)
        : e.code === "NOT_ALLOWED"
          ? fail(403, "ACCESS_DENIED", e.message)
          : fail(400, "INVALID_REQUEST", e.message);
    if (e instanceof z.ZodError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  return (
    new Elysia({ prefix: "/api/workspace", normalize: false })
      // Every workspace the person is in, for the switcher.
      .get("/all", async ({ request }) => {
        try {
          return out(await workspaces.all(await access.requireActive(request.headers)));
        } catch (e) {
          return mapError(e);
        }
      })
      // Root starts a workspace for another organization and gets the invitation of its owner, shown once.
      .post("/new", async ({ request, body }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(await workspaces.create(actor, newInput.parse(body)), 201);
        } catch (e) {
          return mapError(e);
        }
      })
      // A copy of a workspace's data, gzipped: the owner's of the workspace they work in, or root's of any (`?id=`).
      .get("/export", async ({ request, query }) => {
        try {
          if (!operator) return fail(404, "NOT_FOUND", "Not available.");
          const actor = await access.requireActive(request.headers);
          const id = query.id ? idParam.parse(query.id) : actor.workspaceId;
          if (!id) return fail(404, "NOT_FOUND", "You are in no workspace.");
          const copy = await operator.export(actor, id);
          return new Response(copy.body, {
            headers: {
              "content-type": "application/gzip",
              "content-disposition": `attachment; filename="${copy.name}"`,
              "cache-control": "no-store",
            },
          });
        } catch (e) {
          return mapError(e);
        }
      })
      // Root's view of every workspace: what it uses, its limits, suspending and deleting it.
      .get("/operator", async ({ request }) => {
        try {
          if (!operator) return fail(404, "NOT_FOUND", "Not available.");
          return out({
            workspaces: await operator.list(await access.requireActive(request.headers)),
          });
        } catch (e) {
          return mapError(e);
        }
      })
      .put("/operator/:id/quota", async ({ request, params, body }) => {
        try {
          if (!operator) return fail(404, "NOT_FOUND", "Not available.");
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out({
            quota: await operator.setQuota(actor, idParam.parse(params.id), quotaInput.parse(body)),
          });
        } catch (e) {
          return mapError(e);
        }
      })
      .put("/operator/:id/status", async ({ request, params, body }) => {
        try {
          if (!operator) return fail(404, "NOT_FOUND", "Not available.");
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(
            await operator.setStatus(
              actor,
              idParam.parse(params.id),
              statusInput.parse(body).status,
            ),
          );
        } catch (e) {
          return mapError(e);
        }
      })
      .delete("/operator/:id", async ({ request, params }) => {
        try {
          if (!operator) return fail(404, "NOT_FOUND", "Not available.");
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(await operator.remove(actor, idParam.parse(params.id)));
        } catch (e) {
          return mapError(e);
        }
      })
      // A person already here joins another workspace with an invitation made out to them.
      .post("/join", async ({ request, body }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(await workspaces.join(actor, joinInput.parse(body).token));
        } catch (e) {
          return mapError(e);
        }
      })
      .get("/", async ({ request }) => {
        try {
          return out(await workspaces.mine(await access.requireActive(request.headers)));
        } catch (e) {
          return mapError(e);
        }
      })
      .patch("/", async ({ request, body }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(await workspaces.rename(actor, nameInput.parse(body).name));
        } catch (e) {
          return mapError(e);
        }
      })
      .get("/members", async ({ request }) => {
        try {
          return out(await workspaces.members(await access.requireActive(request.headers)));
        } catch (e) {
          return mapError(e);
        }
      })
      .get("/invitations", async ({ request }) => {
        try {
          return out(await workspaces.invitations(await access.requireActive(request.headers)));
        } catch (e) {
          return mapError(e);
        }
      })
      .put("/members/:userId/role", async ({ request, params, body }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(
            await workspaces.setRole(
              actor,
              userParam.parse(params.userId),
              roleInput.parse(body).role,
            ),
          );
        } catch (e) {
          return mapError(e);
        }
      })
      .put("/members/:userId/chief", async ({ request, params, body }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(
            await workspaces.setChief(
              actor,
              userParam.parse(params.userId),
              chiefInput.parse(body).botId,
            ),
          );
        } catch (e) {
          return mapError(e);
        }
      })
      .delete("/members/:userId/chief", async ({ request, params }) => {
        try {
          const denied = rejectUntrustedOrigin(request, trustedOrigins);
          if (denied) return denied;
          const actor = await access.requireActive(request.headers);
          return out(await workspaces.setChief(actor, userParam.parse(params.userId), null));
        } catch (e) {
          return mapError(e);
        }
      })
  );
}
