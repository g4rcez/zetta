// Standalone, opt-in proof only; importing this module never initializes auth/DB.
import { strict as assert } from "node:assert";
import { requireIdentityProofTarget } from "../../test-support/identity-proof-target";
import type { AuthFactoryOptions } from "@zetta/auth";
import type { Database } from "@zetta/db";

/** Installed 1.7.7 test mode implicitly skips origin AND legacy CSRF checks. */
export function requireIdentityAuthProofTarget(env: Readonly<Record<string, string | undefined>>) {
  try {
    const target = requireIdentityProofTarget(env); // Always first, including environment denials.
    if (env.NODE_ENV === "test" || (env.TEST && env.TEST !== "false")
      || Object.keys(env).some((key) => key.startsWith("BETTER_AUTH_TELEMETRY"))) throw new Error();
    return target;
  } catch {
    throw new Error("Identity auth proof target or environment unavailable.");
  }
}

export async function runIdentityAuthProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Identity auth proof deadline exceeded; details suppressed.\n");
      process.exit(1); // Bounds cleanup too; OS closes reserved sockets.
    }, 90000);
    let proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/identity-proof-client").openIdentityProof>> | undefined;
    const restore: (() => void)[] = [];
    let outbound = false;
    const forbidden = () => { outbound = true; throw new Error("Unintended outbound IO."); };
    try {
      phase = "database setup";
      const { openIdentityProof } = await import("../../../../../packages/db/src/identity-proof-client");
      proof = await openIdentityProof(target.connectionString);
      await proof.cleanupFixtures();
      // All DB sockets are already reserved and verified. Deny NEW sockets, DNS,
      // HTTP/fetch/listeners before importing auth; this is not a firewall.
      const net = (await import("node:net")).default;
      const tls = (await import("node:tls")).default;
      const dns = (await import("node:dns")).default;
      const http = (await import("node:http")).default;
      const https = (await import("node:https")).default;
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
      phase = "auth imports";
      const { createAuthOptions } = await import("@zetta/auth");
      const { betterAuth } = await import("better-auth");
      const { randomBytes } = await import("node:crypto");
      const { createAdminLifecycleService } = await import("./admin-lifecycle");
      const { createEnrollmentService, EnrollmentUnavailableError } = await import("./enrollment");
      const { createInvitationSignupPreflight } = await import("./signup-preflight");
      const { owner, firstDb } = proof;
      const config = {
        BETTER_AUTH_URL: "https://auth.identity.invalid",
        CORS_ORIGIN: "https://web.identity.invalid",
        BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      };
      const desktop = "views://mainview";
      const password = randomBytes(24).toString("base64url");
      // Public installed options only. Do NOT call createAuth merely to inspect
      // .options: it eagerly initializes; production API has no test switches.
      const adapterDatabase: Omit<Database, "$client"> = firstDb;
      function proofOptions(options?: AuthFactoryOptions) {
        // Only $client differs (reserved PoolClient vs Pool). Installed 1.7.7
        // relations-v2 never reads $client; SQL proof retains ownership/close.
        return { ...createAuthOptions(config, adapterDatabase as Database, [desktop], options),
          logger: { disabled: true }, telemetry: { enabled: false, debug: false } };
      }
      function request(path: string, body?: object, cookie?: string, origin = config.CORS_ORIGIN, extra = {}) {
        return new Request(`${config.BETTER_AUTH_URL}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(cookie ? { cookie } : {}), ...extra },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      }
      function sessionCookie(response: Response, expired = false) {
        const cookies = response.headers.getSetCookie().filter((cookie) => cookie.startsWith("__Secure-better-auth.session_token="));
        assert.equal(cookies.length, 1);
        const cookie = cookies[0]!;
        for (const attribute of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /;\s*SameSite=None(?:;|$)/i]) assert.match(cookie, attribute);
        if (expired) assert.match(cookie, /;\s*Max-Age=0(?:;|$)/i);
        else assert.doesNotMatch(cookie, /;\s*Max-Age=0(?:;|$)/i);
        return cookie.split(";", 1)[0]!;
      }
      async function userId(response: Response) {
        assert.equal(response.status, 200);
        const body = await response.json() as { user?: { id?: unknown }; token?: unknown };
        assert.equal(typeof body.user?.id, "string");
        return body.user!.id as string;
      }
      async function counts() {
        const result = await owner.query(`select
          (select count(*)::int from "user") as users, (select count(*)::int from account) as accounts,
          (select count(*)::int from session) as sessions, (select count(*)::int from membership) as members,
          (select count(*)::int from invitation where consumed_at is not null) as consumed,
          (select count(*)::int from identity_audit) as audits`);
        return result.rows[0];
      }
      async function adminUnchanged(id: string) {
        const result = await owner.query("select admin_user_id from installation_identity where id=1");
        assert.deepEqual(result.rows, [{ admin_user_id: id }]);
      }
      async function run(name: string, work: () => Promise<void>) {
        phase = name;
        await work();
        proof!.healthy();
        assert.equal(outbound, false); // Even a swallowed outbound error fails.
        process.stdout.write(`PASS ${name}\n`);
      }
      let adminId: string;
      phase = "synthetic fixture provisioning";
      {
        // Fixture ONLY: unexposed legacy composition on the guarded DB, using
        // supported signup handler (library hashing/linking); NOT operator tooling.
        const legacy = betterAuth(proofOptions());
        await legacy.$context; // Own the eager initialization promise immediately.
        const response = await legacy.handler(request("/sign-up/email", {
          name: "Synthetic Operator", email: "operator@identity.invalid", password,
        }));
        adminId = await userId(response);
        const signedOut = await legacy.handler(request("/sign-out", {}, sessionCookie(response)));
        assert.equal(signedOut.status, 200);
        assert.deepEqual(await signedOut.json(), { success: true });
        await createAdminLifecycleService(firstDb).bootstrapExistingAccount({ userId: adminId });
      }
      const enrollment = createEnrollmentService(firstDb);
      const issued = await enrollment.issueInvitation({ userId: adminId }, { intendedEmail: "member@identity.invalid" });
      phase = "gated auth initialization";
      const auth = betterAuth(proofOptions({
        invitationSignupVerifier: createInvitationSignupPreflight(firstDb),
      }));
      const context = await auth.$context;
      assert.equal(context.skipOriginCheck, false);
      assert.equal(context.skipCSRFCheck, false);
      const signup = { name: "Synthetic Member", email: "member@identity.invalid", password };
      let memberId = "";
      let cookie = "";
      let consumedToken = "";

      await run("signup denials precede user account session writes", async () => {
        const before = { users: 1, accounts: 1, sessions: 0, members: 1, consumed: 0, audits: 2 };
        assert.deepEqual(await counts(), before);
        for (const body of [signup, { ...signup, invitationToken: "malformed" },
          ...["operator@identity.invalid", "unknown@identity.invalid"].flatMap((email) => [
            { ...signup, email },
            { ...signup, email, invitationToken: "malformed" },
            { ...signup, email, invitationToken: Buffer.alloc(32, 7).toString("base64url") },
            { ...signup, email, invitationToken: issued.token },
          ]),
          { ...signup, email: "wrong@identity.invalid", invitationToken: issued.token },
          { ...signup, invitationToken: issued.token, role: "admin" }]) {
          const response = await auth.handler(request("/sign-up/email", body));
          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" });
          assert.equal(response.headers.has("set-cookie"), false);
          assert.deepEqual(await counts(), before);
          await adminUnchanged(adminId);
        }
        let aliasResult: { status: number; body: string } | undefined;
        for (const email of ["operator@identity.invalid", "unknown@identity.invalid"]) {
          const response = await auth.handler(request("/sign-up/email/", { ...signup, email }));
          assert.ok(response.status === 400 || response.status === 404);
          const result = { status: response.status, body: await response.text() };
          if (aliasResult) assert.deepEqual(result, aliasResult);
          else aliasResult = result;
          assert.equal(response.headers.has("set-cookie"), false);
          assert.deepEqual(await counts(), before);
        }
      });
      await run("JSON invitation preflight creates credentials session without enrollment", async () => {
        const response = await auth.handler(request("/sign-up/email", { ...signup, invitationToken: issued.token }));
        memberId = await userId(response);
        cookie = sessionCookie(response);
        assert.notEqual(memberId, adminId);
        assert.deepEqual(await counts(), { users: 2, accounts: 2, sessions: 1, members: 1, consumed: 0, audits: 2 });
        const credential = await owner.query(`select count(*)::int as count from account
          where user_id=$1 and account_id=$1 and provider_id='credential' and password is not null`, [memberId]);
        assert.equal(credential.rows[0].count, 1);
        await adminUnchanged(adminId);
      });
      await run("authenticated acceptance rechecks revocation then consumes and activates", async () => {
        const authenticated = await auth.handler(request("/get-session", undefined, cookie));
        assert.equal(await userId(authenticated), memberId); // Actor comes from real stored session, not signup JSON.
        await enrollment.revokeInvitation({ userId: adminId }, { invitationId: issued.invitationId });
        await assert.rejects(enrollment.acceptInvitation({ userId: memberId }, { token: issued.token }), EnrollmentUnavailableError);
        assert.deepEqual(await counts(), { users: 2, accounts: 2, sessions: 1, members: 1, consumed: 0, audits: 3 });
        const fresh = await enrollment.issueInvitation({ userId: adminId }, { intendedEmail: signup.email });
        consumedToken = fresh.token;
        assert.deepEqual(await enrollment.acceptInvitation({ userId: memberId }, { token: fresh.token }), { userId: memberId });
        assert.deepEqual(await counts(), { users: 2, accounts: 2, sessions: 1, members: 2, consumed: 1, audits: 5 });
        const active = await owner.query("select status from membership where user_id=$1", [memberId]);
        assert.deepEqual(active.rows, [{ status: "active" }]);
        const consumed = await owner.query(`select consumed_by_user_id from invitation
          where id=$1 and consumed_at is not null`, [fresh.invitationId]);
        assert.deepEqual(consumed.rows, [{ consumed_by_user_id: memberId }]);
        await adminUnchanged(adminId);
      });
      await run("untrusted origin and cross-site navigation deny without writes", async () => {
        const before = await counts();
        for (const [origin, headers, code] of [
          ["https://untrusted.identity.invalid", {}, "INVALID_ORIGIN"],
          [config.CORS_ORIGIN, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }, "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED"],
        ] as const) {
          const response = await auth.handler(request("/sign-in/email", { email: signup.email, password }, undefined, origin, headers));
          assert.equal(response.status, 403);
          assert.equal((await response.json() as { code?: unknown }).code, code);
          assert.equal(response.headers.has("set-cookie"), false);
          assert.deepEqual(await counts(), before);
        }
        const response = await auth.handler(request("/sign-out", {}, cookie, "https://untrusted.identity.invalid"));
        assert.equal(response.status, 403);
        assert.equal((await response.json() as { code?: unknown }).code, "INVALID_ORIGIN");
        assert.deepEqual(await counts(), before);
        assert.equal(await userId(await auth.handler(request("/get-session", undefined, cookie))), memberId);
      });
      await run("trusted web desktop signin logout invalidate stored sessions and retain cookies", async () => {
        async function logout(current: string, origin: string) {
          const response = await auth.handler(request("/sign-out", {}, current, origin));
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { success: true });
          sessionCookie(response, true);
          const session = await auth.handler(request("/get-session", undefined, current, origin));
          assert.equal(session.status, 200);
          assert.equal(await session.json(), null); // Replaying original cookie cannot restore DB session.
          assert.equal((await counts()).sessions, 0);
        }
        await logout(cookie, config.CORS_ORIGIN);
        for (const origin of [config.CORS_ORIGIN, desktop]) {
          const response = await auth.handler(request("/sign-in/email", { email: signup.email, password }, undefined, origin));
          assert.equal(await userId(response), memberId);
          cookie = sessionCookie(response);
          assert.equal((await counts()).sessions, 1);
          assert.equal(await userId(await auth.handler(request("/get-session", undefined, cookie, origin))), memberId);
          await logout(cookie, origin);
        }
        assert.deepEqual(await counts(), { users: 2, accounts: 2, sessions: 0, members: 2, consumed: 1, audits: 5 });
        await adminUnchanged(adminId);
      });
      await run("expired revoked consumed invitations hide known and unknown accounts", async () => {
        const expired = await enrollment.issueInvitation({ userId: adminId }, { intendedEmail: "operator@identity.invalid" });
        await owner.query("update invitation set created_at=clock_timestamp()-interval '2 days', expires_at=clock_timestamp()-interval '1 day' where id=$1", [expired.invitationId]);
        const before = await counts();
        for (const invitationToken of [expired.token, issued.token, consumedToken]) {
          for (const email of ["operator@identity.invalid", "member@identity.invalid", "unknown@identity.invalid"]) {
            const response = await auth.handler(request("/sign-up/email", { ...signup, email, invitationToken }));
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { code: "FAILED_TO_CREATE_USER", message: "Failed to create user" });
            assert.equal(response.headers.has("set-cookie"), false);
            assert.deepEqual(await counts(), before);
            await adminUnchanged(adminId);
          }
        }
      });
      await run("public credential failure leaves no orphan and invitation remains retryable", async () => {
        const email = "rollback@identity.invalid";
        const invitation = await enrollment.issueInvitation({ userId: adminId }, { intendedEmail: email });
        const before = await counts();
        await owner.query("alter table account add constraint signup_proof_account_fault check (false) not valid");
        const originalError = console.error;
        let diagnosticAttempted = false;
        console.error = () => { diagnosticAttempted = true; };
        try {
          const response = await auth.handler(request("/sign-up/email", { ...signup, email, invitationToken: invitation.token }));
          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), { code: "AUTHENTICATION_UNAVAILABLE", message: "Authentication unavailable" });
          assert.equal(response.headers.has("set-cookie"), false);
          assert.equal(diagnosticAttempted, false);
          process.stdout.write(`OBSERVED public credential failure preserves row counts: ${JSON.stringify(await counts()) === JSON.stringify(before)}\n`);
          assert.deepEqual(await counts(), before);
        } finally {
          console.error = originalError;
          await owner.query("alter table account drop constraint signup_proof_account_fault");
        }
        const retried = await auth.handler(request("/sign-up/email", { ...signup, email, invitationToken: invitation.token }));
        await userId(retried);
        sessionCookie(retried);
        assert.deepEqual(await counts(), { ...before, users: before.users + 1, accounts: before.accounts + 1, sessions: before.sessions + 1 });
      });
      proof.healthy();
      assert.equal(outbound, false);
    } finally {
      const previousPhase = phase;
      phase = "cleanup";
      // Cleanup even if eager auth initialization failed; deadline stays armed.
      try { if (proof) await proof.cleanupFixtures(); }
      finally {
        try { await proof?.close(); }
        finally { for (const undo of restore.reverse()) undo(); clearTimeout(deadline); }
      }
      phase = previousPhase;
    }
    assert.equal(outbound, false);
    process.stdout.write("PASS installed auth enrollment proof (7 checks)\n");
  } catch {
    process.stderr.write(`Identity auth proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await runIdentityAuthProof();
