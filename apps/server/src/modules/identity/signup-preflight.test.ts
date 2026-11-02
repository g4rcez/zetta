import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  createInvitationSignupPolicy,
  type InvitationSignupBefore,
} from "@zetta/auth/invitation-policy";
import type { Database } from "@zetta/db";
import { createInvitationSignupPreflight } from "./signup-preflight";

// Use the dependency owner's real installed Drizzle builder, replacing only the
// pg client protocol. No Pool, connection, env or services are initialized.
type Call = { text: string; params: unknown[] };
const { drizzle } = createRequire(import.meta.resolve("@zetta/db"))(
  "drizzle-orm/node-postgres",
) as {
  drizzle(options: {
    client: { query(query: { text: string }, params: unknown[]): Promise<{ rows: unknown[][] }> };
  }): Pick<Database, "select">;
};
const token = Buffer.alloc(32, 7).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const input = { token, email: "Member+Tag@Example.test" };
const now = Date.parse("2030-01-02T00:00:00Z");
type State = {
  bootstrap: boolean;
  adminActive: boolean;
  hash: string;
  email: string;
  intendedUserId: string | null;
  expires: number;
  revokedAt: Date | null;
  consumedAt: Date | null;
  consumedByUserId: string | null;
};
function fixture(patch: Partial<State> = {}, failure = false) {
  const state: State = {
    bootstrap: true,
    adminActive: true,
    hash,
    email: "member+tag@example.test",
    intendedUserId: null,
    expires: now + 1,
    revokedAt: null,
    consumedAt: null,
    consumedByUserId: null,
    ...patch,
  };
  const calls: Call[] = [];
  const db = drizzle({
    client: {
      async query(query, params = []) {
        calls.push({ text: query.text, params });
        if (failure)
          throw new Error(`driver error including sensitive params ${JSON.stringify(params)}`);
        if (!query.text.startsWith("select ")) throw new Error("Preflight attempted a write");
        // Semantic fixture only, not proof PostgreSQL evaluates these predicates.
        const available =
          state.bootstrap &&
          state.adminActive &&
          params.includes(state.hash) &&
          params.includes(state.email) &&
          state.intendedUserId === null &&
          state.expires > now &&
          state.revokedAt === null &&
          state.consumedAt === null &&
          state.consumedByUserId === null;
        return { rows: available ? [[true]] : [] };
      },
    },
  });
  return { verify: createInvitationSignupPreflight(db), calls, state };
}

test("signup preflight generates one bound read with account/token, bootstrap, binding and DB-clock predicates", async () => {
  const f = fixture();
  expect(await f.verify(input)).toBe(true);
  expect(f.calls).toHaveLength(1);
  const call = f.calls[0]!;
  expect(call.text).toContain('select true from "zetta"."invitation"');
  expect(call.text).toContain('inner join "zetta"."installation_identity"');
  expect(call.text).toContain('"zetta"."installation_identity"."id" = $');
  expect(call.text).toContain('inner join "zetta"."membership"');
  expect(call.text).toContain(
    '"zetta"."membership"."user_id" = "zetta"."installation_identity"."admin_user_id"',
  );
  expect(call.text).toContain('"zetta"."membership"."status" = $');
  expect(call.text).toContain('"zetta"."invitation"."token_hash" = $');
  expect(call.text).toContain('"zetta"."invitation"."intended_email" = $');
  for (const column of ["intended_user_id", "revoked_at", "consumed_at", "consumed_by_user_id"]) {
    expect(call.text).toContain(`"zetta"."invitation"."${column}" is null`);
  }
  expect(call.text).toContain('"zetta"."invitation"."expires_at" > clock_timestamp()');
  expect(call.text).toContain("limit $");
  expect(call.params).toEqual([1, "active", hash, "member+tag@example.test", 1]);
  expect(call.text).not.toContain(hash);
  expect(call.text).not.toContain(input.email);
  expect(JSON.stringify(f.calls)).not.toContain(token);
  expect(call.text).not.toMatch(/\b(insert|update|delete|returning|for update)\b/i);
});

test("signup preflight denies missing bootstrap, inactive admin, mismatch, expiry boundary, revoke, replay and ANY existing-user binding", async () => {
  for (const patch of [
    { bootstrap: false },
    { adminActive: false },
    { hash: "unknown" },
    { email: "other@example.test" },
    { email: "member@example.test" },
    { expires: now },
    { expires: now - 1 },
    { revokedAt: new Date(now) },
    { consumedAt: new Date(now), consumedByUserId: "previous-user" },
    { consumedByUserId: "previous-user" },
    { intendedUserId: "new-user" },
    { intendedUserId: "other-user" },
  ]) {
    const f = fixture(patch);
    expect(await f.verify(input)).toBe(false);
    expect(f.calls).toHaveLength(1);
  }
});

test("signup preflight validates narrow input and canonical token before querying", async () => {
  const f = fixture();
  const alias = token.slice(0, -1) + "d";
  for (const value of [
    null,
    undefined,
    [],
    {},
    { ...input, token: 1 },
    { ...input, token: "invalid" },
    { ...input, token: `${token}=` },
    { ...input, token: alias },
    { ...input, email: "bad" },
    { ...input, email: " member+tag@example.test" },
    { ...input, role: "admin" },
    { ...input, userId: "new-user" },
  ]) {
    expect(await Reflect.apply(f.verify, undefined, [value])).toBe(false);
  }
  expect(f.calls).toEqual([]);
});

test("signup preflight composes with the installed-type hook offline, without authority or consumption", async () => {
  const f = fixture();
  const before = createInvitationSignupPolicy(f.verify);
  const account: Parameters<InvitationSignupBefore>[0] = {
    id: "new-user",
    name: "New member",
    email: input.email,
    emailVerified: false,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  // Partial hook context only; no real signup endpoint or authentication occurs.
  const context = {
    path: "/sign-up/email",
    body: {
      name: account.name,
      email: input.email,
      password: "synthetic-only",
      invitationToken: token,
      image: "https://example.test/synthetic.png",
      rememberMe: false,
      callbackURL: "/",
    },
  } as NonNullable<Parameters<InvitationSignupBefore>[1]>;
  expect(await before(account, context)).toBeUndefined();
  expect(f.calls).toHaveLength(1);
  expect(f.state.consumedAt).toBeNull();
  f.state.intendedUserId = account.id;
  expect(await before(account, context)).toBe(false);
  expect(f.state.consumedAt).toBeNull();
  expect(f.calls.every((call) => call.text.startsWith("select "))).toBe(true);
});

test("signup preflight storage errors deny without exposing driver details", async () => {
  const f = fixture({}, true);
  expect(await f.verify(input)).toBe(false);
  expect(f.calls).toHaveLength(1);
});

test("signup preflight success does not consume invitation, activate membership or prevent a later denial", async () => {
  const f = fixture();
  const initial = structuredClone(f.state);
  expect(await f.verify(input)).toBe(true);
  expect(await f.verify(input)).toBe(true);
  expect(f.state).toEqual(initial);
  f.state.revokedAt = new Date(now);
  expect(await f.verify(input)).toBe(false);
  expect(f.calls.every((call) => call.text.startsWith("select "))).toBe(true);
});

test("signup preflight and policy import without services/env or network startup", async () => {
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Preflight import attempted startup"); };
    Bun.serve = forbidden;
    Bun.connect = forbidden;
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const preflight = await import(${JSON.stringify(new URL("./signup-preflight.ts", import.meta.url).href)});
    const policy = await import(${JSON.stringify(new URL("../../../../../packages/auth/src/invitation-policy.ts", import.meta.url).href)});
    if (typeof preflight.createInvitationSignupPreflight !== "function" || typeof policy.createInvitationSignupPolicy !== "function") throw new Error("Missing exports");
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const source = await Bun.file(new URL("./signup-preflight.ts", import.meta.url)).text();
  expect(source).toContain('import type { Database } from "@zetta/db"');
  expect(source).not.toMatch(/from ["'][^"']*(?:services|config|env)["']|process\.env|Bun\.env/);
});
