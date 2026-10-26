import { expect, test } from "bun:test";
import type { BetterAuthOptions } from "better-auth";
import { createInvitationSignupGate, createInvitationSignupPolicy, type InvitationSignupVerifier, type InvitationSignupBefore } from "./invitation-policy";

type Context = NonNullable<Parameters<InvitationSignupBefore>[1]>;
const token = Buffer.alloc(32, 7).toString("base64url");
const account: Parameters<InvitationSignupBefore>[0] = {
  id: "new-user", name: "New member", email: "Member+Tag@Example.test", emailVerified: false,
  createdAt: new Date(0), updatedAt: new Date(0), image: null,
};
function body() {
  return { name: "New member", email: "Member+Tag@Example.test", password: "synthetic-only", invitationToken: token };
}
// Deliberately partial endpoint fixture: the policy reads only path/body. This
// assertion is not evidence of an installed endpoint or real authentication.
function context(input: unknown, path = "/sign-up/email"): Context {
  return { path, body: input } as Context;
}
function fixture(result = true) {
  const calls: Parameters<InvitationSignupVerifier>[0][] = [];
  const before = createInvitationSignupPolicy(async (input) => { calls.push(input); return result; });
  const options = { databaseHooks: { user: { create: { before } } } } satisfies BetterAuthOptions;
  return { before: options.databaseHooks.user.create.before, calls };
}

test("endpoint invitation gate fails closed with one bounded error and ignores other auth paths", async () => {
  const calls: unknown[] = [];
  const gate = createInvitationSignupGate(async (input) => { calls.push(input); return false; });
  for (const input of [undefined, {}, body(), { ...body(), email: "known@example.test" }]) {
    try {
      await Reflect.apply(gate, undefined, [{ path: "/sign-up/email", body: input }]);
      throw new Error("Gate unexpectedly allowed signup");
    } catch (error) {
      expect(error).toMatchObject({ status: "BAD_REQUEST", body: { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" } });
    }
  }
  expect(calls).toHaveLength(2);
  expect(await Reflect.apply(gate, undefined, [{ path: "/sign-in/email", body: body() }])).toBeUndefined();
  expect(calls).toHaveLength(2);
  const allowed = createInvitationSignupGate(async () => true);
  expect(await Reflect.apply(allowed, undefined, [{ path: "/sign-up/email", body: body() }])).toBeUndefined();
  for (const verify of [undefined, async () => { throw new Error("private database error"); }, async () => "true"]) {
    const broken = Reflect.apply(createInvitationSignupGate, undefined, [verify]);
    await expect(Reflect.apply(broken, undefined, [{ path: "/sign-up/email", body: body() }])).rejects.toMatchObject({
      status: "BAD_REQUEST", body: { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" },
    });
  }
});

test("invitation signup policy denies null/missing context, other paths and missing verifier", async () => {
  const f = fixture();
  expect(await f.before(account, null)).toBe(false);
  expect(await Reflect.apply(f.before, undefined, [account])).toBe(false);
  for (const path of ["/sign-in/email", "/callback/provider", "", "/sign-up/email/other"]) {
    expect(await f.before(account, context(body(), path))).toBe(false);
  }
  const missing = Reflect.apply(createInvitationSignupPolicy, undefined, []);
  expect(await missing(account, context(body()))).toBe(false);
  expect(f.calls).toEqual([]);
});

test("invitation signup policy rejects malformed body/token and authority injection before verification", async () => {
  const f = fixture();
  const alias = token.slice(0, -1) + "d";
  expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(token, "base64url"));
  for (const input of [undefined, null, [], "body", {}, { ...body(), invitationToken: undefined },
    { ...body(), invitationToken: 1 }, { ...body(), invitationToken: "" }, { ...body(), invitationToken: `${token}=` },
    { ...body(), invitationToken: alias }, { ...body(), invitationToken: "x".repeat(44) },
    { ...body(), token }, { ...body(), role: "admin" }, { ...body(), userId: "admin" },
    { ...body(), ownerId: "admin" }, { ...body(), membership: "active" }, { ...body(), emailVerified: true },
    { ...body(), intendedUserId: "new-user" }, { ...body(), invitationToken: undefined, token }]) {
    expect(await f.before(account, context(input))).toBe(false);
  }
  for (const patch of [{ role: "admin" }, { ownerId: "admin" }, { membership: "active" }, { emailVerified: true }]) {
    expect(await f.before({ ...account, ...patch }, context(body()))).toBe(false);
  }
  expect(f.calls).toEqual([]);
});

test("invitation signup policy binds the proposed account to body email with lowercase-only normalization", async () => {
  const f = fixture();
  for (const email of ["", "invalid", " member+tag@example.test", "member@example.test", "other@example.test"]) {
    expect(await f.before({ ...account, email }, context(body()))).toBe(false);
  }
  expect(await f.before(account, context({ ...body(), email: "other@example.test" }))).toBe(false);
  expect(f.calls).toEqual([]);
  expect(await f.before(account, context({ ...body(), email: "MEMBER+TAG@example.test" }))).toBeUndefined();
  expect(f.calls).toEqual([{ token, email: "member+tag@example.test" }]);
});

test("invitation signup policy denies verifier rejection, exceptions and non-boolean success generically", async () => {
  expect(await fixture(false).before(account, context(body()))).toBe(false);
  const broken = createInvitationSignupPolicy(async () => { throw new Error(`sensitive driver detail ${token}`); });
  expect(await broken(account, context(body()))).toBe(false);
  const notBoolean = Reflect.apply(createInvitationSignupPolicy, undefined, [async () => ({ role: "admin" })]);
  expect(await notBoolean(account, context(body()))).toBe(false);
});

test("invitation signup policy allows preflight only, without mutating user/body or returning authority", async () => {
  const f = fixture();
  const input = Object.freeze(body());
  const user = Object.freeze({ ...account });
  expect(await f.before(user, context(input))).toBeUndefined();
  expect(input).toEqual(body());
  expect(user).toEqual(account);
  expect(f.calls).toEqual([{ token, email: "member+tag@example.test" }]);
});

test("installed Better Auth 1.7.7 source supports extra signup body fields and nullable create-before contract (not real signup)", async () => {
  const base = new URL("./", import.meta.resolve("better-auth"));
  const pkg = await Bun.file(new URL("../package.json", base)).json();
  expect(pkg.version).toBe("1.7.7");
  const signup = await Bun.file(new URL("api/routes/sign-up.mjs", base)).text();
  expect(signup).toContain('}).and(z.record(z.string(), z.any()))');
  expect(signup).toContain('createAuthEndpoint("/sign-up/email"');
  expect(signup).toContain("const body = ctx.body;");
  expect(signup).toContain("ctx.context.internalAdapter.createUser({");
  const hooks = await Bun.file(new URL("db/with-hooks.mjs", base)).text();
  expect(hooks).toContain("const context = tryGetCurrentAuthEndpointContext();");
  expect(hooks).toContain("toRun(actualData, context)");
  expect(hooks).toContain("if (result === false) return null;");
  const core = new URL("./", import.meta.resolve("@better-auth/core"));
  const types = await Bun.file(new URL("types/init-options.d.mts", core)).text();
  expect(types).toContain("before?: (user: User & Record<string, unknown>, context: GenericEndpointContext | null)");
  const endpoint = await Bun.file(new URL("context/endpoint-context.mjs", core)).text();
  expect(endpoint).toContain("function tryGetCurrentAuthEndpointContext()");
  const api = await Bun.file(new URL("api/index.mjs", core)).text();
  expect(api).toContain("runWithEndpointContext(context, () => handler(context))");
});
