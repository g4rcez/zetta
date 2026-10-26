import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { Database } from "@zetta/db";
import { createEnrollmentService, EnrollmentUnavailableError } from "./enrollment";

// Resolve the already-installed driver from the package that owns its dependency.
// No Pool, connection, services or env are instantiated. Only the pg query protocol
// is replaced; production uses the real installed Drizzle SQL/transaction builder.
type Query = { text: string; rowMode?: string };
type Call = { text: string; params: unknown[] };
const { drizzle } = createRequire(import.meta.resolve("@zetta/db"))("drizzle-orm/node-postgres") as {
  drizzle(options: { client: { query(query: Query, params: unknown[]): Promise<{ rows: unknown[][] }> } }): Pick<Database, "transaction">;
};
const token = Buffer.alloc(32, 7).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const now = Date.parse("2030-01-02T00:00:00Z");
const actor = { userId: "member" };
const admin = { userId: "admin" };

type Invite = { id: string; hash: string; email: string; userId: string | null; expires: number; revoked: boolean; consumed: boolean };
type State = {
  bootstrap: boolean; adminId: string; adminActive: boolean; accountExists: boolean; missingAccounts: string[]; email: string;
  memberRevision: unknown; member: "active" | "removed" | null; invite: Invite | null; audits: string[];
};
function fixture(patch: Partial<State> = {}, options: { auditFailure?: boolean; membershipFailure?: boolean; activationNoRow?: boolean; claimDelay?: number } = {}) {
  let state: State = {
    bootstrap: true, adminId: "admin", adminActive: true, accountExists: true, missingAccounts: [], email: "Member@Example.test",
    memberRevision: 1, member: null, invite: { id: "invite", hash, email: "member@example.test", userId: "member", expires: now + 1, revoked: false, consumed: false },
    audits: [], ...patch,
  };
  let snapshot = structuredClone(state);
  const calls: Call[] = [];
  const db = drizzle({ client: { async query(query, params = []) {
    const text = query.text;
    calls.push({ text, params });
    let rows: unknown[][] = [];
    if (text.startsWith("begin")) snapshot = structuredClone(state);
    else if (text === "rollback") state = snapshot;
    else if (text === "commit") { /* Drizzle commits after callback completes. */ }
    else if (text.includes('from "installation_identity"')) rows = state.bootstrap ? [[state.adminId]] : [];
    else if (text.includes('from "membership"') && text.includes('"status" =')) rows = state.adminActive ? [[state.adminId]] : [];
    else if (text.includes('from "user"')) rows = state.accountExists && !state.missingAccounts.includes(String(params[0])) ? [[params[0], state.email]] : [];
    else if (text.includes('from "membership"')) rows = params[0] === state.adminId ? state.adminActive ? [["active", 1]] : [] : state.member ? [[state.member, state.memberRevision]] : [];
    else if (text.startsWith('insert into "invitation"')) {
      state.invite = { id: String(params[0]), hash: String(params[1]), email: String(params[2]), userId: params[3] as string | null, expires: now + 86_400_000, revoked: false, consumed: false };
      rows = [[state.invite.id, new Date(state.invite.expires).toISOString()]];
    } else if (text.startsWith('update "invitation"') && text.includes('set "consumed_at"')) {
      // Semantic fixture only: PostgreSQL predicate/locking enforcement belongs to 004c.
      const invite = state.invite;
      if (invite && invite.hash === params[1] && invite.email === params[2]
        && (invite.userId === null || invite.userId === params[3]) && !invite.revoked && !invite.consumed
        && invite.expires > now + (options.claimDelay ?? 0)) {
        invite.consumed = true;
        rows = [[invite.id]];
      }
    } else if (text.startsWith('update "invitation"') && text.includes('set "revoked_at"')) {
      const invite = state.invite;
      if (invite && invite.id === params[0] && !invite.revoked && !invite.consumed && invite.expires > now) {
        invite.revoked = true;
        rows = [[invite.id]];
      }
    } else if (text.startsWith('insert into "membership"')) {
      if (options.membershipFailure) throw new Error("synthetic membership write failure");
      if (!options.activationNoRow) {
        state.memberRevision = state.member ? params[4] : params[1];
        state.member = "active";
        rows = [[params[0]]];
      }
    } else if (text.startsWith('insert into "identity_audit"')) {
      if (options.auditFailure) throw new Error(`synthetic driver error; sensitive params: ${JSON.stringify(params)}`);
      state.audits.push(String(params[1]));
    } else throw new Error(`Unexpected SQL in fixture: ${text}`);
    return { rows };
  } } });
  return { service: createEnrollmentService(db), calls, state: () => state };
}
async function denied(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("Expected enrollment denial");
  } catch (error) {
    expect(error).toBeInstanceOf(EnrollmentUnavailableError);
    expect((error as Error).message).toBe(new EnrollmentUnavailableError().message);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  }
}
function changedInvite(patch: Partial<Invite>): State["invite"] {
  return { id: "invite", hash, email: "member@example.test", userId: "member", expires: now + 1, revoked: false, consumed: false, ...patch };
}

test("enrollment imports without services, environment, network or database startup", async () => {
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Enrollment import attempted startup"); };
    Bun.serve = forbidden;
    Bun.connect = forbidden;
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const enrollment = await import(${JSON.stringify(new URL("./enrollment.ts", import.meta.url).href)});
    if (typeof enrollment.createEnrollmentService !== "function") throw new Error("Missing service");
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const source = await Bun.file(new URL("./enrollment.ts", import.meta.url)).text();
  expect(source).toContain('import type { Database } from "@zetta/db"');
  expect(source).not.toMatch(/from ["'][^"']*(?:services|config|env)["']|process\.env|Bun\.env/);
});

test("issueInvitation uses random one-time tokens, lowercase-only binding, DB expiry and safe audited output", async () => {
  const f = fixture();
  const first = await f.service.issueInvitation(admin, { intendedEmail: "MiXeD+Tag@Example.test", intendedUserId: "member" });
  expect(Buffer.from(first.token, "base64url").length).toBe(32);
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Object.keys(first).sort()).toEqual(["expiresAt", "invitationId", "token"]);
  expect(f.state().invite?.hash).toBe(createHash("sha256").update(first.token).digest("hex"));
  expect(f.state().invite?.email).toBe("mixed+tag@example.test");
  expect(f.state().invite?.userId).toBe("member");
  expect(f.state().audits).toEqual(["invite-issued"]);
  expect(first.expiresAt.getTime()).toBe(now + 86_400_000);
  const second = await f.service.issueInvitation(admin, { intendedEmail: "member@example.test" });
  expect(second.token).not.toBe(first.token);
  expect(f.state().invite?.userId).toBeNull();
  expect(JSON.stringify(f.calls)).not.toContain(first.token);
  const insert = f.calls.find((call) => call.text.startsWith('insert into "invitation"'))!;
  expect(insert.text).toContain("statement_timestamp()");
  expect(insert.text).toContain("interval '24 hours'");
  expect(insert.text.split("returning")[1]).not.toContain("token_hash");
});

test("all operations reject malformed input and forged body authority before opening transactions", async () => {
  const f = fixture();
  for (const input of [null, [], {}, { token: 1 }, { token: "not-a-token" }, { token: `${token}=` }, { token, role: "admin" }, { token, userId: "admin" }, { token, email: "member@example.test" }]) {
    await denied(f.service.acceptInvitation(actor, input));
  }
  // Same decoded bytes with noncanonical final base64 bits must not alias a token.
  const alias = token.slice(0, -1) + "d";
  expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(token, "base64url"));
  await denied(f.service.acceptInvitation(actor, { token: alias }));
  for (const input of [{ intendedEmail: "bad" }, { intendedEmail: " x@example.test" }, { intendedEmail: "x@example.test", role: "admin" }, { intendedEmail: "x@example.test", issuedByUserId: "admin" }, { intendedEmail: "x@example.test", intendedUserId: "" }]) {
    await denied(f.service.issueInvitation(admin, input));
  }
  await denied(f.service.revokeInvitation(admin, { invitationId: "invite", role: "admin" }));
  await denied(f.service.acceptInvitation({ userId: "" }, { token }));
  expect(f.calls).toEqual([]);
});

test("missing bootstrap, inactive admin, stale authority and missing stored account fail closed", async () => {
  for (const patch of [{ bootstrap: false }, { adminActive: false }, { accountExists: false }]) {
    for (const operation of ["issue", "revoke", "accept"]) {
      const f = fixture(patch);
      await denied(operation === "issue" ? f.service.issueInvitation(admin, { intendedEmail: "member@example.test" })
        : operation === "revoke" ? f.service.revokeInvitation(admin, { invitationId: "invite" }) : f.service.acceptInvitation(actor, { token }));
      expect(f.calls.at(-1)?.text).toBe("rollback");
      expect(f.state().audits).toEqual([]);
    }
  }
  for (const operation of ["issue", "revoke"]) {
    const f = fixture({ adminId: "replacement" });
    await denied(operation === "issue" ? f.service.issueInvitation(admin, { intendedEmail: "member@example.test" }) : f.service.revokeInvitation(admin, { invitationId: "invite" }));
    expect(f.calls.some((call) => call.text.startsWith("insert") || call.text.startsWith("update"))).toBe(false);
  }
});

test("acceptInvitation denies wrong stored email/user, exact expiry, expired, revoked, replayed and unknown tokens", async () => {
  const cases: Partial<State>[] = [
    { email: "different@example.test" }, { invite: changedInvite({ userId: "different-user" }) },
    { invite: changedInvite({ email: "member+tag@example.test" }) },
    { invite: changedInvite({ expires: now }) }, { invite: changedInvite({ expires: now - 1 }) },
    { invite: changedInvite({ revoked: true }) }, { invite: changedInvite({ consumed: true }) },
    { invite: changedInvite({ hash: "different-hash" }) }, { invite: null },
  ];
  for (const patch of cases) {
    const f = fixture(patch);
    await denied(f.service.acceptInvitation(actor, { token }));
    expect(f.state().member).toBeNull();
    expect(f.state().audits).toEqual([]);
    expect(f.calls.at(-1)?.text).toBe("rollback");
  }
  const wrongUser = fixture();
  await denied(wrongUser.service.acceptInvitation({ userId: "other-account" }, { token }));
  expect(wrongUser.state().invite?.consumed).toBe(false);
  const delayed = fixture({}, { claimDelay: 1 });
  await denied(delayed.service.acceptInvitation(actor, { token }));
});

test("duplicate active membership never attempts to consume; removed membership explicitly reactivates", async () => {
  const active = fixture({ member: "active" });
  await denied(active.service.acceptInvitation(actor, { token }));
  expect(active.state().invite?.consumed).toBe(false);
  expect(active.calls.some((call) => call.text.startsWith('update "invitation"'))).toBe(false);
  const removed = fixture({ member: "removed" });
  expect(await removed.service.acceptInvitation(actor, { token })).toEqual({ userId: "member" });
  expect(removed.state().member).toBe("active");
  expect(removed.state().invite?.consumed).toBe(true);
  expect(removed.state().audits).toEqual(["invite-consumed"]);
  const activation = removed.calls.find((call) => call.text.startsWith('insert into "membership"'))!;
  expect(activation.text).toContain('on conflict ("user_id") do update set');
  expect(activation.text).toContain('"removed_at" = $');
  expect(activation.params).toContain("removed");
  expect(activation.text.split("do update set")[1]).not.toContain('"joined_at" =');
  expect(removed.calls.some((call) => /schedule|readiness/.test(call.text))).toBe(false);
});

test("acceptInvitation commits once, supports email-only binding, and replay cannot write again", async () => {
  const f = fixture({ invite: changedInvite({ userId: null }) });
  expect(await f.service.acceptInvitation(actor, { token })).toEqual({ userId: "member" });
  expect(f.calls.at(-1)?.text).toBe("commit");
  expect(f.state().audits).toEqual(["invite-consumed"]);
  await denied(f.service.acceptInvitation(actor, { token }));
  expect(f.state().audits).toEqual(["invite-consumed"]);
  // Replay with no active membership must also be denied by the consumption predicate.
  const replay = fixture({ invite: changedInvite({ consumed: true }), member: "removed" });
  await denied(replay.service.acceptInvitation(actor, { token }));
});

test("revokeInvitation is conditional, audited, safe and cannot be repeated or applied after consumption/expiry", async () => {
  const f = fixture();
  expect(await f.service.revokeInvitation(admin, { invitationId: "invite" })).toEqual({ invitationId: "invite" });
  expect(f.state().audits).toEqual(["invite-revoked"]);
  await denied(f.service.acceptInvitation(actor, { token }));
  await denied(f.service.revokeInvitation(admin, { invitationId: "invite" }));
  for (const invite of [changedInvite({ consumed: true }), changedInvite({ expires: now }), null]) {
    await denied(fixture({ invite }).service.revokeInvitation(admin, { invitationId: "invite" }));
  }
  await denied(fixture().service.revokeInvitation(admin, { invitationId: "unknown" }));
});

test("membership and audit failure trigger actual Drizzle ROLLBACK orchestration with no secret-bearing error", async () => {
  for (const options of [{ membershipFailure: true }, { auditFailure: true }, { activationNoRow: true }]) {
    const f = fixture({ member: "removed" }, options);
    await denied(f.service.acceptInvitation(actor, { token }));
    expect(f.state().invite?.consumed).toBe(false);
    expect(f.state().member).toBe("removed");
    expect(f.state().audits).toEqual([]);
    expect(f.calls.at(-1)?.text).toBe("rollback");
    expect(f.calls.some((call) => call.text === "commit")).toBe(false);
  }
  const issue = fixture({}, { auditFailure: true });
  const before = structuredClone(issue.state());
  await denied(issue.service.issueInvitation(admin, { intendedEmail: "member@example.test" }));
  expect(issue.state()).toEqual(before);
  const revoke = fixture({}, { auditFailure: true });
  await denied(revoke.service.revokeInvitation(admin, { invitationId: "invite" }));
  expect(revoke.state().invite?.revoked).toBe(false);
});

test("actual SQL keeps locks, DB-clock conditional claim and membership/audit inside one transaction", async () => {
  const f = fixture();
  await f.service.acceptInvitation(actor, { token });
  expect(f.calls[0]?.text).toBe("begin isolation level read committed");
  expect(f.calls[1]?.text).toContain('from "installation_identity"');
  expect(f.calls[1]?.text).toContain("for update");
  expect(f.calls[2]?.text).toContain('from "user"');
  expect(f.calls[2]?.text).toContain("for update");
  expect(f.calls[3]?.text).toContain('from "user"');
  expect(f.calls[3]?.text).toContain("for update");
  expect(f.calls[4]?.text).toContain('from "membership"');
  expect(f.calls[4]?.text).toContain("for update");
  expect(f.calls[5]?.text).toContain('from "membership"');
  expect(f.calls[5]?.text).toContain("for update");
  const claim = f.calls[6]!;
  expect(claim.text).toContain('update "invitation"');
  for (const column of ["revoked_at", "consumed_at", "consumed_by_user_id", "intended_user_id"]) {
    expect(claim.text).toContain(`"${column}" is null`);
  }
  expect(claim.text).toContain('"invitation"."expires_at" > clock_timestamp()');
  expect(claim.text).toContain('"invitation"."token_hash" = $2');
  expect(claim.text).toContain('"invitation"."intended_email" = $3');
  expect(claim.text).toContain('"invitation"."intended_user_id" = $4');
  expect(claim.params).toEqual(["member", hash, "member@example.test", "member"]);
  expect(claim.text.split("returning")[1]).not.toContain("token_hash");
  expect(f.calls[7]?.text).toContain('insert into "membership"');
  expect(f.calls[8]?.text).toContain('insert into "identity_audit"');
  expect(f.calls[9]?.text).toBe("commit");
  expect(f.calls).toHaveLength(10);
  expect(JSON.stringify(f.calls)).not.toContain(token);
});

const lockCalls = (calls: readonly Call[]) => calls.filter(call => call.text.endsWith(" for update"))
  .map(call => [call.text.match(/from "(installation_identity|user|membership)"/)?.[1], call.params[0]]);

test("acceptance locks every account before sorted memberships in either lexical order", async () => {
  for (const adminId of ["a-admin", "z-admin"]) {
    const f = fixture({ adminId });
    await f.service.acceptInvitation(actor, { token });
    const ids = [adminId, actor.userId].sort();
    expect(lockCalls(f.calls)).toEqual([["installation_identity", 1], ...ids.map(id => ["user", id]), ...ids.map(id => ["membership", id])]);
    expect(f.state().audits).toEqual(["invite-consumed"]);
  }
});

test("invitation issuance prelocks optional user FK targets without requiring their membership", async () => {
  for (const intendedUserId of [undefined, "a-target", "z-target", "admin"]) {
    const f = fixture();
    await f.service.issueInvitation(admin, { intendedEmail: "member@example.test", ...(intendedUserId ? { intendedUserId } : {}) });
    const ids = [...new Set([admin.userId, ...(intendedUserId ? [intendedUserId] : [])])].sort();
    expect(lockCalls(f.calls)).toEqual([["installation_identity", 1], ...ids.map(id => ["user", id]), ["membership", admin.userId]]);
    expect(f.state().member).toBeNull();
  }
  const revoked = fixture();
  await revoked.service.revokeInvitation(admin, { invitationId: "invite" });
  expect(lockCalls(revoked.calls)).toEqual([["installation_identity", 1], ["user", "admin"], ["membership", "admin"]]);
});

test("missing required accounts deny before membership or invitation effects", async () => {
  for (const missing of ["admin", "member"]) {
    const f = fixture({ missingAccounts: [missing] });
    await denied(f.service.acceptInvitation(actor, { token }));
    expect(f.calls.some(call => call.text.includes('from "membership"') || call.text.startsWith('update "invitation"'))).toBe(false);
    expect(f.state().invite?.consumed).toBe(false);
  }
  const f = fixture({ missingAccounts: ["target"] });
  await denied(f.service.issueInvitation(admin, { intendedEmail: "member@example.test", intendedUserId: "target" }));
  expect(f.calls.some(call => call.text.startsWith("insert") || call.text.includes('from "membership"'))).toBe(false);
  expect(f.state().audits).toEqual([]);
});

test("activation revision is locked, bounded before consumption, and incremented only in conflict UPDATE", async () => {
  for (const revision of [0, -1, null, "1", 1.5, NaN, 2147483648, 2147483647]) {
    const f = fixture({ member: "removed", memberRevision: revision });
    await denied(f.service.acceptInvitation(actor, { token }));
    expect(f.calls.some(c => /^(insert|update|delete)/.test(c.text))).toBe(false);
    expect(f.state().invite?.consumed).toBe(false);
  }
  for (const revision of [1, 37, 2147483646]) {
    const f = fixture({ member: "removed", memberRevision: revision });
    await f.service.acceptInvitation(actor, { token });
    const write = f.calls.find(c => c.text.startsWith('insert into "membership"'));
    expect(write?.params).toEqual(["member", 1, "active", null, revision + 1, "active", null, "removed", revision]);
    expect(f.state().memberRevision).toBe(revision + 1);
    expect(write?.text).toContain('"membership"."activation_revision" =');
    expect(f.calls.find(c => c.text.includes('from "membership"'))?.text).toContain('"activation_revision"');
  }
  const active = fixture({ member: "active", memberRevision: 2147483647 });
  await denied(active.service.acceptInvitation(actor, { token }));
  expect(active.calls.some(c => c.text.startsWith('update "invitation"'))).toBe(false);
});
