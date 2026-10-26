import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { requireIdentityAuthProofTarget } from "./signup.integration";

/** Opt-in disposable proof. Import and target rejection never start auth, DB or children. */
export async function runCredentialOperatorProof() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const children = new Set<Bun.Subprocess<"pipe", "pipe", "pipe">>();
    const deadline = setTimeout(() => {
      for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
      process.stderr.write("Credential operator proof deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 90_000);
    let proof: Awaited<ReturnType<typeof import("../../../../../packages/db/src/identity-proof-client").openIdentityProof>> | undefined;
    try {
      phase = "database setup";
      const { openIdentityProof } = await import("../../../../../packages/db/src/identity-proof-client");
      proof = await openIdentityProof(target.connectionString);
      const { owner, firstDb } = proof;
      const cli = fileURLToPath(new URL("./credential-operator-cli.ts", import.meta.url));
      function command(action: "bootstrap" | "replace", input: object) {
        const child = Bun.spawn([process.execPath, "--no-env-file", cli, action], {
          env: { ZETTA_OPERATOR_DATABASE_URL: target.connectionString, ZETTA_OPERATOR_ALLOW_MUTATION: "identity-admin" },
          stdin: "pipe", stdout: "pipe", stderr: "pipe", timeout: 25_000,
        });
        children.add(child);
        child.stdin.write(JSON.stringify(input));
        child.stdin.end();
        async function capture(stream: ReadableStream<Uint8Array>) {
          const reader = stream.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let text = "", bytes = 0;
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) return text + decoder.decode();
              bytes += next.value.byteLength;
              assert.equal(bytes <= 4096, true);
              text += decoder.decode(next.value, { stream: true });
            }
          } finally { reader.releaseLock(); }
        }
        const result = Promise.all([child.exited, capture(child.stdout), capture(child.stderr)])
          .then(([exit, stdout, stderr]) => ({ exit, stdout, stderr }));
        void result.catch(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
        return result;
      }
      function receipt(actual: Awaited<ReturnType<typeof command>>, failure?: "input" | "provisioning" | "activation") {
        // Boolean assertion prevents assertion formatting from exposing unexpected child output.
        assert.equal(actual.exit === (failure ? 1 : 0)
          && actual.stdout === (failure ? "" : "Credential operator completed.\n")
          && actual.stderr === (failure ? `Credential operator unavailable (${failure}).\n` : ""), true);
      }
      phase = "auth composition";
      const { createAuthOptions } = await import("@zetta/auth");
      const { createInvitationSignupPreflight } = await import("./signup-preflight");
      const { betterAuth } = await import("better-auth");
      const { randomBytes } = await import("node:crypto");
      const { z } = await import("zod");
      const origin = "https://web.identity.invalid";
      const config = { BETTER_AUTH_URL: "https://auth.identity.invalid", BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), CORS_ORIGIN: origin };
      const auth = betterAuth({ ...createAuthOptions(config, firstDb, [], {
        invitationSignupVerifier: createInvitationSignupPreflight(firstDb),
      }), logger: { disabled: true }, telemetry: { enabled: false, debug: false } });
      const password = randomBytes(24).toString("base64url");
      const alternate = randomBytes(24).toString("base64url");
      const credentials = (email: string, secret = password) => ({ name: "Synthetic CLI Operator", email, password: secret });
      function request(path: string, body?: object, cookie?: string) {
        return new Request(`${config.BETTER_AUTH_URL}/api/auth${path}`, {
          method: body ? "POST" : "GET",
          headers: { origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
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
      async function user(email: string) {
        const result = await owner.query<{ id: string }>('select id from "user" where email=$1', [email]);
        assert.equal(result.rows.length, 1);
        const row = result.rows[0];
        assert.ok(row);
        return row.id;
      }
      async function counts() {
        return (await owner.query(`select (select count(*)::int from "user") as users,
          (select count(*)::int from account) as accounts, (select count(*)::int from session) as sessions,
          (select count(*)::int from membership) as members, (select count(*)::int from installation_identity) as admins,
          (select count(*)::int from identity_audit) as audits`)).rows;
      }
      async function orphan(email: string) {
        const id = await user(email);
        assert.deepEqual((await owner.query(`select
          (select count(*)::int from account where user_id=$1 and account_id=$1 and provider_id='credential' and password is not null and password <> '') as credentials,
          (select count(*)::int from membership where user_id=$1) as members,
          (select count(*)::int from installation_identity where admin_user_id=$1) as admins,
          (select count(*)::int from identity_audit where subject_user_id=$1) as audits,
          (select count(*)::int from session where user_id=$1) as sessions`, [id])).rows,
        [{ credentials: 1, members: 0, admins: 0, audits: 0, sessions: 0 }]);
        return id;
      }
      async function check(name: string, work: () => Promise<void>) {
        phase = name;
        await work();
        proof?.healthy();
        process.stdout.write(`PASS ${name}\n`);
      }
      let adminId = "";
      await check("real credential CLI closed input denies without rows", async () => {
        receipt(await command("bootstrap", { ...credentials("invalid@identity.invalid"), role: "admin" }), "input");
        assert.deepEqual(await counts(), [{ users: 0, accounts: 0, sessions: 0, members: 0, admins: 0, audits: 0 }]);
      });
      await check("real credential CLI bootstrap creates one credential admin and audit without session", async () => {
        receipt(await command("bootstrap", credentials("admin@identity.invalid")));
        adminId = await user("admin@identity.invalid");
        assert.deepEqual(await counts(), [{ users: 1, accounts: 1, sessions: 0, members: 1, admins: 1, audits: 1 }]);
        assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: adminId }]);
        assert.deepEqual((await owner.query("select user_id,status from membership")).rows, [{ user_id: adminId, status: "active" }]);
        assert.deepEqual((await owner.query("select event_kind,actor_kind,actor_user_id,subject_user_id,operator_reason from identity_audit")).rows,
          [{ event_kind: "bootstrap", actor_kind: "operator", actor_user_id: null, subject_user_id: adminId, operator_reason: null }]);
        assert.equal((await signin("admin@identity.invalid")).id, adminId);
      });
      await check("real credential CLI duplicate denies without adoption or credential replacement", async () => {
        const before = await counts();
        receipt(await command("replace", { ...credentials("ADMIN@identity.invalid", alternate), expectedAdminUserId: adminId, reason: "planned-transfer" }), "provisioning");
        assert.deepEqual(await counts(), before);
        assert.equal((await user("admin@identity.invalid")), adminId);
        const wrong = await auth.handler(request("/sign-in/email", { email: "admin@identity.invalid", password: alternate }));
        assert.equal(wrong.status, 401);
        assert.equal(wrong.headers.has("set-cookie"), false);
        assert.equal((await signin("admin@identity.invalid")).id, adminId);
      });
      await check("wrong expected admin leaves a new unentitled credential account", async () => {
        receipt(await command("replace", { ...credentials("orphan@identity.invalid"), expectedAdminUserId: "stale-admin", reason: "planned-transfer" }), "activation");
        await orphan("orphan@identity.invalid");
        assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: adminId }]);
        assert.equal((await owner.query("select count(*)::int as count from identity_audit")).rows[0]?.count, 1);
      });
      await check("activation audit failure preserves unentitled credentials and original authority", async () => {
        await owner.query("alter table identity_audit add constraint credential_cli_audit_fault check (false) not valid");
        try {
          receipt(await command("replace", { ...credentials("fault@identity.invalid"), expectedAdminUserId: adminId, reason: "admin-unavailable" }), "activation");
          await orphan("fault@identity.invalid");
          assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: adminId }]);
          assert.deepEqual((await owner.query("select user_id,status from membership")).rows, [{ user_id: adminId, status: "active" }]);
        } finally { await owner.query("alter table identity_audit drop constraint credential_cli_audit_fault"); }
      });
      await check("real replacement CLI revokes both actual cookies and preserves unrelated authentication", async () => {
        phase = "replacement preexisting signin";
        const old = await signin("admin@identity.invalid");
        const control = await signin("orphan@identity.invalid");
        let replacementSession: Awaited<ReturnType<typeof signin>> | undefined;
        let pending: ReturnType<typeof command> | undefined;
        await owner.query("begin");
        try {
          await owner.query("select id from installation_identity where id=1 for update");
          pending = command("replace", { ...credentials("replacement@identity.invalid"), expectedAdminUserId: adminId, reason: "planned-transfer" });
          phase = "replacement activation lock barrier";
          const barrier = AbortSignal.timeout(1500);
          while (true) {
            barrier.throwIfAborted();
            await owner.query("select pg_stat_clear_snapshot()");
            const waiting = await owner.query(`select count(*)::int as count from pg_stat_activity where
              application_name='zetta-identity-admin' and wait_event_type='Lock' and query ilike '%installation_identity%for update%'
              and pg_backend_pid()=any(pg_blocking_pids(pid))`);
            if (waiting.rows[0]?.count === 1) break;
          }
          // Creation already committed; the distinct lifecycle transaction is blocked on the singleton.
          phase = "replacement committed unentitled readback";
          await orphan("replacement@identity.invalid");
          phase = "replacement preactivation cookie signin";
          replacementSession = await signin("replacement@identity.invalid");
          phase = "replacement preactivation cookie verification";
          for (const current of [old, replacementSession, control]) assert.equal(await session(current.cookie), current.id);
        } finally {
          try { await owner.query("rollback"); }
          finally { if (pending) await pending; }
        }
        assert.ok(replacementSession);
        phase = "replacement CLI completion";
        receipt(await pending);
        phase = "replacement effective cookie revocation";
        assert.equal(await session(old.cookie), null);
        assert.equal(await session(replacementSession.cookie), null);
        assert.equal(await session(control.cookie), control.id);
        phase = "replacement final authority and counts";
        assert.deepEqual((await owner.query("select admin_user_id from installation_identity")).rows, [{ admin_user_id: replacementSession.id }]);
        assert.deepEqual((await owner.query("select user_id=$1 as previous,status from membership where user_id=any($2::text[]) order by previous desc",
          [adminId, [adminId, replacementSession.id]])).rows, [{ previous: true, status: "active" }, { previous: false, status: "active" }]);
        assert.deepEqual((await owner.query("select event_kind,actor_kind,actor_user_id,subject_user_id,operator_reason from identity_audit where event_kind='admin-replacement'")).rows,
          [{ event_kind: "admin-replacement", actor_kind: "operator", actor_user_id: null, subject_user_id: replacementSession.id, operator_reason: "planned-transfer" }]);
        assert.equal((await owner.query("select count(*)::int as count from session where user_id=any($1::text[])", [[adminId, replacementSession.id]])).rows[0]?.count, 0);
        assert.deepEqual(await counts(), [{ users: 4, accounts: 4, sessions: 1, members: 2, admins: 1, audits: 2 }]);
      });
    } finally {
      const previousPhase = phase;
      phase = "cleanup";
      try {
        for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
        await Promise.allSettled([...children].map((child) => child.exited));
        try { if (proof) await proof.cleanupFixtures(); }
        finally { await proof?.close(); }
      } finally { clearTimeout(deadline); }
      phase = previousPhase;
    }
    process.stdout.write("PASS actual credential operator CLI proof (6 checks); synthetic rows only\n");
  } catch { // no-excuse-ok: catch -- proof output suppresses account data, credentials and driver details.
    process.stderr.write(`Credential operator proof failed at ${phase}; details suppressed.\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await runCredentialOperatorProof();
