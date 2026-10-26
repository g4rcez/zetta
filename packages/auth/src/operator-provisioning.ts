import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@zetta/db";
import * as schema from "@zetta/db/schema/auth";
import { betterAuth } from "better-auth";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

const credentials = z.strictObject({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});
const configSchema = z.strictObject({
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
});

export type OperatorCredentials = Readonly<z.infer<typeof credentials>>;
export type OperatorProvisioningConfig = Readonly<z.infer<typeof configSchema>>;
export type OperatorProvisioningDatabase = Pick<Database, "select" | "insert" | "update" | "delete" | "transaction" | "query">;
export type OperatorProvisioningResult =
  | Readonly<{ ok: true; userId: string }>
  | Readonly<{ ok: false; code: "invalid_input" | "provisioning_failed" }>;

/** Verification projects no hashes, tokens, or private account fields. */
export type OperatorProvisioningReadback = Readonly<{
  users: readonly Readonly<{ id: string; email: string }>[];
  accounts: readonly Readonly<{ userId: string; accountId: string; providerId: string; passwordPresent: boolean }>[];
  sessionPresent: boolean;
}>;
export type OperatorProvisioningDependencies = Readonly<{
  signUpEmail: (input: Readonly<{ body: OperatorCredentials }>) => Promise<Readonly<{
    token: string | null;
    user: Readonly<{ id: string; email: string }>;
  }>>;
  readback: (userId: string, email: string) => Promise<OperatorProvisioningReadback>;
}>;

/** Trusted operator boundary, never an HTTP handler. One attempt; uncertain failure is opaque. */
export async function provisionOperatorCredentials(
  input: unknown,
  dependencies: OperatorProvisioningDependencies,
): Promise<OperatorProvisioningResult> {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  try {
    const result = await dependencies.signUpEmail({ body: parsed.data });
    const email = parsed.data.email.toLowerCase();
    if (result.token !== null || !result.user.id || result.user.email !== email) {
      return { ok: false, code: "provisioning_failed" };
    }
    const persisted = await dependencies.readback(result.user.id, email);
    const user = persisted.users[0];
    const account = persisted.accounts[0];
    if (persisted.users.length !== 1 || user?.id !== result.user.id || user.email !== email
      || persisted.accounts.length !== 1 || account?.userId !== result.user.id
      || account.accountId !== result.user.id || account.providerId !== "credential"
      || account.passwordPresent !== true || persisted.sessionPresent !== false) {
      return { ok: false, code: "provisioning_failed" };
    }
    return { ok: true, userId: result.user.id };
  } catch { // no-excuse-ok: catch -- trusted boundary must not disclose library/driver errors or input.
    return { ok: false, code: "provisioning_failed" };
  }
}

/** Construction is inert. The private, never-mounted auth instance starts only on a valid invocation. */
export function createOperatorCredentialProvisioner(config: OperatorProvisioningConfig, database: OperatorProvisioningDatabase) {
  return (input: unknown): Promise<OperatorProvisioningResult> => provisionOperatorCredentials(input, {
    async signUpEmail(request) {
      const env = configSchema.parse(config);
      const auth = betterAuth({
        database: drizzleAdapter(database, { provider: "pg", schema, transaction: true }),
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        trustedOrigins: [],
        emailAndPassword: { enabled: true, disableSignUp: false, autoSignIn: false },
        plugins: [],
        logger: { disabled: true },
        telemetry: { enabled: false, debug: false },
      });
      return auth.api.signUpEmail({ body: request.body });
    },
    async readback(userId, email) {
      const users = await database.select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user).where(and(eq(schema.user.id, userId), eq(schema.user.email, email))).limit(2);
      const accounts = await database.select({
        userId: schema.account.userId,
        accountId: schema.account.accountId,
        providerId: schema.account.providerId,
        passwordPresent: sql<boolean>`${schema.account.password} is not null and ${schema.account.password} <> ''`,
      }).from(schema.account).where(eq(schema.account.userId, userId)).limit(2);
      const sessions = await database.select({ present: sql<boolean>`true` })
        .from(schema.session).where(eq(schema.session.userId, userId)).limit(1);
      return { users, accounts, sessionPresent: sessions.length !== 0 };
    },
  });
}
