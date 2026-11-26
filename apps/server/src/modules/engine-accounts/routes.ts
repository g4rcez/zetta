import { Elysia } from "elysia";
import { z } from "zod";
import {
  ACCOUNT_ENGINES,
  ACCOUNT_LABEL_MAX,
  ENGINE_SIGN_IN,
  SHARED_ACCOUNT,
  ACCOUNT_SCOPES,
} from "@zetta/core/engine-accounts";
import { TransportError } from "@zetta/core/sealed-transport";
import type { bot } from "@zetta/db/schema/chat";
import { TransportKeyExpiredError, type TransportKeyring } from "../connections/transport";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { EngineAccountError, type EngineAccounts } from "./service";
import type { SignIns } from "./sign-in";

export type EngineAccountServices = {
  access: ReturnType<typeof createIdentityAccess>;
  accounts: EngineAccounts;
  signIns: SignIns;
  /** Opens a secret that was sealed in the browser for this person and this purpose. */
  keyring: TransportKeyring;
  /** A bot the person can see and use, or NOT_FOUND. */
  botFor: (actor: ActiveActor, botId: string) => Promise<typeof bot.$inferSelect>;
};

const uuid = z.uuid();
const engine = z.enum(ACCOUNT_ENGINES);
const pasteInput = z.strictObject({
  engine,
  method: z.string().min(1).max(40),
  provider: z.string().max(40).optional(),
  label: z
    .string()
    .max(ACCOUNT_LABEL_MAX * 2)
    .optional(),
  sealed: z.unknown(),
  for: z.enum(ACCOUNT_SCOPES).optional(),
});
const startInput = z.strictObject({
  engine,
  method: z.string().min(1).max(40),
  for: z.enum(ACCOUNT_SCOPES).optional(),
});
const codeInput = z.strictObject({ text: z.string().min(1).max(4000) });
const nameInput = z.strictObject({
  label: z
    .string()
    .min(1)
    .max(ACCOUNT_LABEL_MAX * 2),
});
const choiceInput = z.strictObject({
  harness: engine.nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  accountId: uuid.nullable().optional(),
});
const sharedInput = z.strictObject({ sharedAccount: z.enum(SHARED_ACCOUNT) });

/**
 * A person's agent accounts: connect one (a guided sign-in, or a pasted token or key that arrives sealed), choose the default, name
 * it, disconnect it, and choose the engine and account for one bot. An administrator sees which engines each person of the workspace
 * has an account for, and can disconnect one. A secret is never in an answer.
 */
export function createEngineAccountRoutes(
  { access, accounts, signIns, keyring, botFor }: EngineAccountServices,
  trustedOrigins: readonly string[],
) {
  function mapError(e: unknown) {
    if (e instanceof AccessError) return accessFail(e);
    if (e instanceof EngineAccountError)
      return e.code === "NOT_FOUND"
        ? fail(404, "NOT_FOUND", e.message)
        : e.code === "UNAVAILABLE"
          ? fail(409, "UNAVAILABLE", e.message)
          : fail(400, "INVALID_REQUEST", e.message);
    if (e instanceof TransportKeyExpiredError)
      return fail(409, "TRANSPORT_KEY_EXPIRED", "The encryption key rotated. Try again.");
    if (e instanceof z.ZodError || e instanceof TransportError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  type Ctx = { actor: ActiveActor; body: unknown; params: Record<string, string> };
  const read =
    (work: (c: Ctx) => Promise<unknown> | unknown) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        return out(
          await work({ actor: await access.requireActive(request.headers), body, params }),
        );
      } catch (e) {
        return mapError(e);
      }
    };
  const write =
    (work: (c: Ctx) => Promise<unknown> | unknown, status = 200) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        return out(
          await work({ actor: await access.requireActive(request.headers), body, params }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };

  return (
    new Elysia({ prefix: "/api/engine-accounts", normalize: false })
      .get(
        "/",
        read(async (c) => ({ ...(await accounts.list(c.actor)), methods: ENGINE_SIGN_IN })),
      )
      // The token or key arrives sealed to the server key (see @zetta/core/sealed-transport); a plain `secret` fails the strict schema.
      .post(
        "/",
        write(async (c) => {
          const input = pasteInput.parse(c.body);
          const { secret } = z.strictObject({ secret: z.string().min(1).max(8000) }).parse(
            await keyring.open(input.sealed, {
              userId: c.actor.userId,
              purpose: `engine-account.create:${input.engine}`,
            }),
          );
          return {
            account: await accounts.createFromSecret(c.actor, {
              engine: input.engine,
              method: input.method,
              provider: input.provider,
              label: input.label,
              secret,
              for: input.for,
            }),
          };
        }, 201),
      )
      .post(
        "/sign-in",
        write(async (c) => {
          const input = startInput.parse(c.body);
          return {
            signIn: await signIns.start(c.actor, input.engine, input.method, input.for),
          };
        }, 201),
      )
      .get(
        "/sign-in/:id",
        read((c) => ({ signIn: signIns.get(c.actor, uuid.parse(c.params.id)) })),
      )
      .post(
        "/sign-in/:id/input",
        write((c) => ({
          signIn: signIns.input(c.actor, uuid.parse(c.params.id), codeInput.parse(c.body).text),
        })),
      )
      .delete(
        "/sign-in/:id",
        write((c) => signIns.cancel(c.actor, uuid.parse(c.params.id))),
      )
      // For an owner or an administrator: which engines each person of the workspace has an account for.
      .get(
        "/people",
        read((c) => accounts.overview(c.actor)),
      )
      .delete(
        "/people/:userId/:id",
        write((c) =>
          accounts.remove(
            c.actor,
            uuid.parse(c.params.id),
            z.string().min(1).max(128).parse(c.params.userId),
          ),
        ),
      )
      .get(
        "/bots/:botId",
        read(async (c) => ({
          choice: await accounts.choice(c.actor, await botFor(c.actor, uuid.parse(c.params.botId))),
        })),
      )
      .put(
        "/bots/:botId",
        write(async (c) => ({
          choice: await accounts.setChoice(
            c.actor,
            await botFor(c.actor, uuid.parse(c.params.botId)),
            choiceInput.parse(c.body),
          ),
        })),
      )
      .put(
        "/bots/:botId/shared",
        write(async (c) =>
          accounts.setShared(
            c.actor,
            await botFor(c.actor, uuid.parse(c.params.botId)),
            sharedInput.parse(c.body).sharedAccount,
          ),
        ),
      )
      .post(
        "/:id/check",
        write(async (c) => {
          const id = uuid.parse(c.params.id);
          const row = await accounts.own(c.actor, id);
          if (row.kind === "login") await signIns.check(row);
          else await accounts.retry(c.actor, id);
          return { account: (await accounts.list(c.actor)).accounts.find((a) => a.id === id) };
        }),
      )
      // The workspace's own account, for an owner or an administrator to disconnect.
      .delete(
        "/workspace/:id",
        write((c) => accounts.removeForWorkspace(c.actor, uuid.parse(c.params.id))),
      )
      .put(
        "/:id/default",
        write(async (c) => ({
          account: await accounts.setDefault(c.actor, uuid.parse(c.params.id)),
        })),
      )
      .patch(
        "/:id",
        write(async (c) => ({
          account: await accounts.rename(
            c.actor,
            uuid.parse(c.params.id),
            nameInput.parse(c.body).label,
          ),
        })),
      )
      .delete(
        "/:id",
        write((c) => accounts.remove(c.actor, uuid.parse(c.params.id))),
      )
  );
}
