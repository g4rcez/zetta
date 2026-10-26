import { expect, test } from "bun:test";
import type { Database } from "@zetta/db";
import type { betterAuth, BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { createAuth, createAuthOptions, type AuthConfig, type AuthFactoryOptions, type Session } from "./index";
import type { InvitationSignupBefore, InvitationSignupVerifier } from "./invitation-policy";

const env: AuthConfig = {
  BETTER_AUTH_URL: "https://auth.example.test",
  BETTER_AUTH_SECRET: "synthetic-only-not-a-production-secret",
  CORS_ORIGIN: "https://web.example.test",
};
// Only configuration assembly is tested. Any database access is a fixture error;
// no client, Better Auth instance, auth context or handler is initialized.
const database = new Proxy({} as Database, {
  get() { throw new Error("Configuration assembly accessed the database"); },
});
const desktopOrigins = Object.freeze(["tauri://localhost", "http://tauri.localhost"]);
const token = Buffer.alloc(32, 7).toString("base64url");
const user: Parameters<InvitationSignupBefore>[0] = {
  id: "new-user", name: "New member", email: "Member+Tag@Example.test", emailVerified: false,
  createdAt: new Date(0), updatedAt: new Date(0),
};
function signupContext() {
  // Deliberately partial synthetic path/body fixture, as in invitation-policy.test.
  // Reflect.apply below supplies it without claiming a real endpoint context.
  return { path: "/sign-up/email", body: {
    name: user.name, email: user.email, password: "synthetic-only", invitationToken: token,
  } };
}
function before(options: ReturnType<typeof createAuthOptions>) {
  const hook = options.databaseHooks?.user.create.before;
  if (!hook) throw new Error("Missing invitation signup hook");
  return hook;
}

test("gated auth preserves API failures and bounds unexpected errors before router diagnostics", () => {
  const options = createAuthOptions(env, database, [], { invitationSignupVerifier: async () => false });
  const boundary = options.onAPIError?.onError;
  if (!boundary) throw new Error("Missing error boundary");
  const original = new APIError("BAD_REQUEST", { code: "EXISTING", message: "Existing safe error" });
  expect(() => boundary(original)).toThrow(original);
  for (const cause of [new Error("private driver detail"), { detail: "private row" }, null]) {
    try {
      boundary(cause);
      throw new Error("Unexpected error was not bounded");
    } catch (error) {
      expect(error).toMatchObject({ status: "INTERNAL_SERVER_ERROR", body: {
        code: "AUTHENTICATION_UNAVAILABLE", message: "Authentication unavailable",
      } });
    }
  }
});

test("createAuthOptions preserves the legacy config and existing createAuth invocation/Session contracts", () => {
  const legacy = createAuthOptions(env, database) satisfies BetterAuthOptions;
  expect(Object.keys(legacy).sort()).toEqual([
    "advanced", "baseURL", "database", "emailAndPassword", "plugins", "secret", "trustedOrigins",
  ]);
  expect(legacy.databaseHooks).toBeUndefined();
  expect(typeof legacy.database).toBe("function");
  expect(legacy.trustedOrigins).toEqual([env.CORS_ORIGIN]);
  expect(legacy.emailAndPassword).toEqual({ enabled: true });
  // Boolean checks avoid emitting even synthetic secrets/config in a failure.
  expect(legacy.secret === env.BETTER_AUTH_SECRET).toBe(true);
  expect(legacy.baseURL === env.BETTER_AUTH_URL).toBe(true);
  expect(legacy.advanced).toEqual({ defaultCookieAttributes: { sameSite: "none", secure: true, httpOnly: true } });
  expect(legacy.plugins).toEqual([]);
  expect(createAuthOptions(env, database, desktopOrigins).trustedOrigins).toEqual([env.CORS_ORIGIN, ...desktopOrigins]);
  expect(createAuthOptions(env, database, desktopOrigins, undefined).databaseHooks).toBeUndefined();
  const existingCaller: (env: AuthConfig, db: Database, origins?: readonly string[]) => ReturnType<typeof createAuth> = createAuth;
  expect(typeof existingCaller).toBe("function");
  const verifierRequired: {} extends NonNullable<Parameters<typeof createAuth>[3]> ? false : true = true;
  type LegacyConfig = Omit<ReturnType<typeof createAuthOptions>, "databaseHooks">;
  type LegacySession = ReturnType<typeof betterAuth<LegacyConfig>>["$Infer"]["Session"];
  const sessionInferenceUnchanged: [Session, LegacySession] extends [LegacySession, Session] ? true : false = true;
  expect(verifierRequired).toBe(true);
  expect(sessionInferenceUnchanged).toBe(true);
});

test("createAuthOptions installs only the accepted invitation create-before delegate", async () => {
  const calls: Parameters<InvitationSignupVerifier>[0][] = [];
  const trustedOptions: AuthFactoryOptions = {
    invitationSignupVerifier: async (input) => { calls.push(input); return true; },
  };
  const options = createAuthOptions(env, database, desktopOrigins, trustedOptions);
  expect(Object.keys(options.databaseHooks ?? {})).toEqual(["user"]);
  expect(Object.keys(options.databaseHooks?.user ?? {})).toEqual(["create"]);
  expect(Object.keys(options.databaseHooks?.user.create ?? {})).toEqual(["before"]);
  expect(await Reflect.apply(before(options), undefined, [user, signupContext()])).toBeUndefined();
  expect(calls).toEqual([{ token, email: "member+tag@example.test" }]);
  expect(options.trustedOrigins).toEqual([env.CORS_ORIGIN, ...desktopOrigins]);
  expect(options.emailAndPassword).toEqual({ enabled: true });
  expect(options.advanced).toEqual({ defaultCookieAttributes: { sameSite: "none", secure: true, httpOnly: true } });
  expect(options.plugins).toEqual([]);
});

test("createAuthOptions explicit malformed verifier/context fails closed through the existing policy", async () => {
  for (const supplied of [null, false, 0, "", {}, { invitationSignupVerifier: undefined }, { invitationSignupVerifier: null },
    { invitationSignupVerifier: true }, { invitationSignupVerifier: async () => false },
    { invitationSignupVerifier: async () => "true" },
    { invitationSignupVerifier: async () => { throw new Error("synthetic private driver cause"); } }]) {
    const config = Reflect.apply(createAuthOptions, undefined, [env, database, desktopOrigins, supplied]);
    expect(await Reflect.apply(before(config), undefined, [user, signupContext()])).toBe(false);
  }
  let calls = 0;
  const hook = before(createAuthOptions(env, database, [], { invitationSignupVerifier: async () => { calls++; return true; } }));
  for (const context of [undefined, null, {}, { path: "/sign-in/email", body: signupContext().body },
    { path: "/sign-up/email", body: null }]) {
    expect(await Reflect.apply(hook, undefined, [user, context])).toBe(false);
  }
  expect(calls).toBe(0);
});

test("createAuthOptions import/config assembly is offline in an env-autoload-disabled process", async () => {
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Auth config attempted runtime startup"); };
    Bun.serve = forbidden;
    Bun.listen = forbidden;
    Bun.connect = forbidden;
    net.Server.prototype.listen = forbidden;
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const { createAuthOptions } = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
    const database = new Proxy({}, { get: forbidden });
    const env = { BETTER_AUTH_URL: "https://auth.example.test", CORS_ORIGIN: "https://web.example.test", BETTER_AUTH_SECRET: "synthetic-only-not-a-production-secret" };
    const legacy = createAuthOptions(env, database);
    const gated = createAuthOptions(env, database, [], { invitationSignupVerifier: async () => false });
    if (legacy.databaseHooks !== undefined || typeof gated.databaseHooks?.user.create.before !== "function"
      || typeof legacy.database !== "function") throw new Error("Incorrect auth config seam");
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  // Do not print subprocess diagnostic causes or configuration on failure.
  expect(exitCode === 0 && stdout === "" && stderr === "").toBe(true);
});

test("installed Better Auth 1.7.7 is eager; createAuth delegates exact config without initializing it here", async () => {
  const base = new URL("./", import.meta.resolve("better-auth"));
  expect((await Bun.file(new URL("../package.json", base)).json()).version).toBe("1.7.7");
  const factory = await Bun.file(new URL("auth/base.mjs", base)).text();
  expect(factory).toContain("const authContext = initFn(options).then(");
  const full = await Bun.file(new URL("auth/full.mjs", base)).text();
  expect(full).toContain("return createBetterAuth(options, init);");
  const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();
  expect(source).toContain("return betterAuth(createAuthOptions(env, database, desktopOrigins, options));");
  expect(source).toContain('import * as schema from "@zetta/db/schema/auth"');
  expect(source).toContain('provider: "pg",\n      transaction: true,\n      schema,');
  expect(source).toContain("before: createInvitationSignupPolicy(options?.invitationSignupVerifier, options?.firstAccount)");
  expect(source).not.toContain("/schema/identity");
});
