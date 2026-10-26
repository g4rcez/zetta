import { strict as assert } from "node:assert";
import { requireIdentityAuthProofTarget } from "./signup.integration";

/** Opt-in disposable proof; imports never initialize auth, timers or database. */
export async function runCredentialProvisioningProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Credential proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 90_000);
    let proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/identity-proof-client").openIdentityProof>> | undefined;
    const restore: (() => void)[] = [];
    let outbound = false;
    try {
      phase = "database setup";
      const { openIdentityProof } = await import("../../../../../packages/db/src/identity-proof-client");
      proof = await openIdentityProof(target.connectionString);
      const net = (await import("node:net")).default;
      const tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default;
      const http = (await import("node:http")).default;
      const https = (await import("node:https")).default;
      const forbidden = () => { outbound = true; throw new Error("Unintended outbound IO."); };
      for (const [object, key] of [
        [net.Socket.prototype, "connect"], [net.Server.prototype, "listen"], [tls, "connect"],
        [dns, "lookup"], [dns, "resolve"], [dns.promises, "lookup"], [dns.promises, "resolve"],
        [http, "request"], [http, "get"], [https, "request"], [https, "get"],
        [Bun, "connect"], [Bun, "listen"], [Bun, "serve"], [globalThis, "fetch"],
      ] as const) {
        const previous = Reflect.get(object, key);
        assert.equal(Reflect.set(object, key, forbidden), true);
        restore.push(() => { Reflect.set(object, key, previous); });
      }
      phase = "auth composition";
      const { createOperatorCredentialProvisioner } = await import("@zetta/auth/operator-provisioning");
      const { createAuthOptions } = await import("@zetta/auth");
      const { createInvitationSignupPreflight } = await import("./signup-preflight");
      const { createAdminLifecycleService, AdminLifecycleUnavailableError } = await import("./admin-lifecycle");
      const { betterAuth } = await import("better-auth");
      const { randomBytes } = await import("node:crypto");
      const { z } = await import("zod");
      const { owner, firstDb, secondDb } = proof;
      const config = { BETTER_AUTH_URL: "https://auth.identity.invalid", BETTER_AUTH_SECRET: randomBytes(48).toString("base64url") };
      const origin = "https://web.identity.invalid";
      const password = randomBytes(24).toString("base64url");
      const alternative = randomBytes(24).toString("base64url");
      const provision = createOperatorCredentialProvisioner(config, firstDb);
      const provisionSecond = createOperatorCredentialProvisioner(config, secondDb);
      // Actual production cookie and invitation-policy options on the owned test database.
      const auth = betterAuth({
        ...createAuthOptions({ ...config, CORS_ORIGIN: origin }, firstDb, [], {
          invitationSignupVerifier: createInvitationSignupPreflight(firstDb),
        }),
        logger: { disabled: true }, telemetry: { enabled: false, debug: false },
      });
      const context = await auth.$context;
      assert.equal(context.skipOriginCheck, false);
      assert.equal(context.skipCSRFCheck, false);
      const lifecycle = createAdminLifecycleService(firstDb);
      const input = (email: string, secret = password) => ({ name: "Synthetic Operator", email, password: secret });
      function request(path: string, body?: object, cookie?: string) {
        return new Request(`${config.BETTER_AUTH_URL}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      }
      async function signin(email: string, secret = password) {
        const response = await auth.handler(request("/sign-in/email", { email, password: secret }));
        assert.equal(response.status, 200);
        const id = z.object({ user: z.object({ id: z.string().min(1) }) }).parse(await response.json()).user.id;
        const cookies = response.headers.getSetCookie().filter((value) => value.startsWith("__Secure-better-auth.session_token="));
        assert.equal(cookies.length, 1);
        const full = cookies[0];
        assert.ok(full);
        for (const attribute of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /;\s*SameSite=None(?:;|$)/i]) assert.match(full, attribute);
        const cookie = full.split(";", 1)[0];
        assert.ok(cookie);
        return { id, cookie };
      }
      async function session(cookie: string) {
        const response = await auth.handler(request("/get-session", undefined, cookie));
        assert.equal(response.status, 200);
        const body: unknown = await response.json();
        return body === null ? null : z.object({ user: z.object({ id: z.string() }) }).parse(body).user.id;
      }
      async function counts() {
        return (await owner.query(`select (select count(*)::int from "user") as users,
          (select count(*)::int from account) as accounts, (select count(*)::int from session) as sessions,
          (select count(*)::int from membership) as members, (select count(*)::int from installation_identity) as admins,
          (select count(*)::int from identity_audit) as audits`)).rows;
      }
      async function check(name: string, work: () => Promise<void>) {
        phase = name;
        await work();
        proof?.healthy();
        assert.equal(outbound, false);
        process.stdout.write(`PASS ${name}\n`);
      }
      let adminId = "";
      await check("operator signup creates one credential without session or authority", async () => {
        const created = await provision(input("operator@identity.invalid"));
        assert.ok(created.ok);
        adminId = created.userId;
        assert.deepEqual(Object.keys(created).sort(), ["ok", "userId"]);
        assert.deepEqual(await counts(), [{ users: 1, accounts: 1, sessions: 0, members: 0, admins: 0, audits: 0 }]);
        assert.deepEqual((await owner.query(`select provider_id, account_id = user_id as linked,
          password is not null and password <> '' as password_present from account where user_id=$1`, [adminId])).rows,
        [{ provider_id: "credential", linked: true, password_present: true }]);
      });
      await check("failed bootstrap retains the new unentitled account", async () => {
        const before = await counts();
        await owner.query("alter table identity_audit add constraint credential_proof_audit_fault check (false) not valid");
        try {
          await assert.rejects(lifecycle.bootstrapExistingAccount({ userId: adminId }), AdminLifecycleUnavailableError);
          assert.deepEqual(await counts(), before);
          assert.equal((await owner.query('select count(*)::int as count from "user" where id=$1', [adminId])).rows[0]?.count, 1);
        } finally { await owner.query("alter table identity_audit drop constraint credential_proof_audit_fault"); }
      });
      await check("duplicate signup denies without replacing credentials and password signin is enforced", async () => {
        const before = await counts();
        assert.deepEqual(await provision(input("OPERATOR@identity.invalid", alternative)), { ok: false, code: "provisioning_failed" });
        assert.deepEqual(await counts(), before);
        const wrong = await auth.handler(request("/sign-in/email", { email: "operator@identity.invalid", password: alternative }));
        assert.equal(wrong.status, 401);
        assert.equal(wrong.headers.has("set-cookie"), false);
        const signed = await signin("operator@identity.invalid");
        assert.equal(signed.id, adminId);
        assert.equal(await session(signed.cookie), adminId);
      });
      await check("account link failure rolls back signup user transaction", async () => {
        const before = await counts();
        await owner.query("alter table account add constraint credential_proof_account_fault check (false) not valid");
        try {
          assert.deepEqual(await provision(input("rollback@identity.invalid")), { ok: false, code: "provisioning_failed" });
          assert.deepEqual(await counts(), before);
          assert.equal((await owner.query('select count(*)::int as count from "user" where email=$1', ["rollback@identity.invalid"])).rows[0]?.count, 0);
        } finally { await owner.query("alter table account drop constraint credential_proof_account_fault"); }
      });
      await check("simultaneous same email signup commits one account and never adopts the winner", async () => {
        const contenders: ReturnType<typeof provision>[] = [];
        await owner.query("begin");
        try {
          await owner.query('lock table "user" in share mode');
          contenders.push(provision(input("race@identity.invalid")), provisionSecond(input("race@identity.invalid", alternative)));
          const barrier = AbortSignal.timeout(1500);
          while (true) {
            barrier.throwIfAborted();
            await owner.query("select pg_stat_clear_snapshot()");
            const waiting = await owner.query(`select count(*)::int as count from pg_stat_activity where
              application_name in ('zetta-identity-proof-1','zetta-identity-proof-2') and wait_event_type='Lock'
              and query ilike '%insert into "user"%' and pg_backend_pid() = any(pg_blocking_pids(pid))`);
            if (waiting.rows[0]?.count === 2) break;
          }
        } finally {
          try { await owner.query("rollback"); }
          finally { await Promise.allSettled(contenders); }
        }
        const results = await Promise.all(contenders);
        assert.equal(results.filter((value) => value.ok).length, 1);
        assert.equal(results.filter((value) => !value.ok && value.code === "provisioning_failed").length, 1);
        const winner = results.find((value) => value.ok);
        assert.ok(winner?.ok);
        const winnerPassword = results[0]?.ok ? password : alternative;
        assert.equal((await signin("race@identity.invalid", winnerPassword)).id, winner.userId);
        const loserPassword = results[0]?.ok ? alternative : password;
        assert.equal((await auth.handler(request("/sign-in/email", { email: "race@identity.invalid", password: loserPassword }))).status, 401);
        assert.equal((await owner.query('select count(*)::int as count from "user" where email=$1', ["race@identity.invalid"])).rows[0]?.count, 1);
        assert.equal((await owner.query("select count(*)::int as count from account where user_id=$1", [winner.userId])).rows[0]?.count, 1);
      });
      await check("public signup missing or invalid invitation denies without writes", async () => {
        const before = await counts();
        for (const extra of [{}, { invitationToken: "invalid" }, { invitationToken: randomBytes(32).toString("base64url") }]) {
          const response = await auth.handler(request("/sign-up/email", { ...input("public@identity.invalid"), ...extra }));
          assert.equal(response.status, 400);
          assert.equal(response.headers.has("set-cookie"), false);
          assert.deepEqual(await counts(), before);
        }
      });
      await check("admin replacement invalidates both actual cookies and preserves unrelated authentication", async () => {
        const replacement = await provision(input("replacement@identity.invalid"));
        const control = await provision(input("control@identity.invalid"));
        assert.ok(replacement.ok && control.ok);
        await lifecycle.bootstrapExistingAccount({ userId: adminId });
        const oldSession = await signin("operator@identity.invalid");
        const newSession = await signin("replacement@identity.invalid");
        const controlSession = await signin("control@identity.invalid");
        for (const current of [oldSession, newSession, controlSession]) assert.equal(await session(current.cookie), current.id);
        await lifecycle.replaceAdminWithExistingAccount({ expectedAdminUserId: adminId, newAdminUserId: replacement.userId, reason: "planned-transfer" });
        assert.equal(await session(oldSession.cookie), null);
        assert.equal(await session(newSession.cookie), null);
        assert.equal(await session(controlSession.cookie), control.userId);
        assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: replacement.userId }]);
        assert.equal((await owner.query("select count(*)::int as count from session where user_id=any($1::text[])", [[adminId, replacement.userId]])).rows[0]?.count, 0);
      });
    } finally {
      const previousPhase = phase;
      phase = "cleanup";
      try { if (proof) await proof.cleanupFixtures(); }
      finally {
        try { await proof?.close(); }
        finally { for (const undo of restore.reverse()) undo(); clearTimeout(deadline); }
      }
      phase = previousPhase;
    }
    assert.equal(outbound, false);
    process.stdout.write("PASS actual credential and cookie revocation proof (7 checks); synthetic rows only\n");
  } catch { // no-excuse-ok: catch -- executable proof deliberately suppresses secrets and driver details.
    process.stderr.write(`Credential proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await runCredentialProvisioningProof();
