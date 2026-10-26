import { requireIdentityAuthProofTarget } from "../modules/identity/signup.integration";

export async function runIdentityBrowserServer() {
  let phase = "target validation";
  try {
    const target = requireIdentityAuthProofTarget(process.env);
    const stopped = Promise.withResolvers<void>();
    const stop = () => stopped.resolve();
    const gracefulDeadline = setTimeout(stop, 14 * 60_000);
    const hardDeadline = setTimeout(() => {
      process.stderr.write("Identity browser deadline exceeded; details suppressed.\n");
      process.exit(1);
    }, 15 * 60_000);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    let proof: Awaited<ReturnType<typeof import("@zetta/db/identity-proof-client").openIdentityProof>> | undefined;
    let app: ReturnType<typeof import("../app").createApp> | undefined;
    let input: ReturnType<typeof import("node:readline").createInterface> | undefined;
    let commands = Promise.resolve();
    let commandFailed = false;
    let completed = false;
    try {
      phase = "database setup";
      const { openIdentityProof } = await import("@zetta/db/identity-proof-client");
      proof = await openIdentityProof(target.connectionString);
      const owned = proof;
      phase = "auth composition";
      const { createOperatorCredentialProvisioner } = await import("@zetta/auth/operator-provisioning");
      const { createAuthOptions } = await import("@zetta/auth");
      const { createAdminLifecycleService } = await import("../modules/identity/admin-lifecycle");
      const { createInvitationSignupPreflight } = await import("../modules/identity/signup-preflight");
      const { createIdentityAccess, createMembershipLookup } = await import("../modules/identity/access");
      const { createEnrollmentService } = await import("../modules/identity/enrollment");
      const { createApp } = await import("../app");
      const { betterAuth } = await import("better-auth");
      const { initLogger } = await import("evlog");
      const { randomBytes } = await import("node:crypto");
      const { createInterface } = await import("node:readline");
      const config = {
        BETTER_AUTH_URL: "http://localhost:3002",
        CORS_ORIGIN: "http://localhost:3001",
        BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      };
      phase = "synthetic provisioning";
      const provision = createOperatorCredentialProvisioner({ BETTER_AUTH_URL: config.BETTER_AUTH_URL, BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET }, owned.firstDb);
      const admin = await provision({ name: "Synthetic Browser Admin", email: "browser-admin@identity.invalid", password: "Synthetic-Browser-Admin-2026!" });
      if (!admin.ok) throw new Error("Fixture provisioning unavailable");
      phase = "synthetic bootstrap";
      await createAdminLifecycleService(owned.firstDb).bootstrapExistingAccount({ userId: admin.userId });
      phase = "gated auth initialization";
      const auth = betterAuth({
        ...createAuthOptions(config, owned.firstDb, [], { invitationSignupVerifier: createInvitationSignupPreflight(owned.firstDb) }),
        logger: { disabled: true }, telemetry: { enabled: false, debug: false },
      });
      const context = await auth.$context;
      if (context.skipOriginCheck || context.skipCSRFCheck) throw new Error("Fixture security configuration unavailable");
      initLogger({ enabled: false, silent: true, plugins: [], drain: () => {} });
      app = createApp({ auth, webOrigin: config.CORS_ORIGIN, desktopOrigins: [], drain: () => {}, identity: {
        access: createIdentityAccess(auth, createMembershipLookup(owned.firstDb)),
        enrollment: createEnrollmentService(owned.firstDb),
      } });
      phase = "listener startup";
      app.listen({ hostname: "127.0.0.1", port: 3002 });
      input = createInterface({ input: process.stdin, terminal: false });
      input.on("line", (line) => {
        if (line === "stop") { stop(); return; }
        if (line !== "remove-member") { process.stdout.write("Identity browser command unavailable.\n"); return; }
        commands = commands.then(async () => {
          await owned.second.query("begin");
          try {
            await owned.second.query("select id from installation_identity where id=1 for update");
            const removed = await owned.second.query(`update membership set status='removed', removed_at=clock_timestamp(), updated_at=clock_timestamp()
              where user_id in (select id from "user" where email='browser-member@identity.invalid')
              and status='active' and user_id not in (select admin_user_id from installation_identity) returning user_id`);
            if (removed.rowCount !== 1) throw new Error("Fixture member unavailable");
            await owned.second.query(`delete from session where user_id in (select id from "user" where email='browser-member@identity.invalid')`);
            await owned.second.query("commit");
            process.stdout.write("PASS test-only synthetic member removal and session invalidation\n");
          } catch {
            await owned.second.query("rollback");
            throw new Error("Fixture removal unavailable");
          }
        }).catch(() => { commandFailed = true; stop(); });
      });
      input.once("close", stop);
      phase = "browser session";
      process.stdout.write("READY identity browser fixture http://localhost:3002\n");
      await stopped.promise;
      input.close();
      await commands;
      if (commandFailed) throw new Error("Fixture command unavailable");
      owned.healthy();
      completed = true;
    } finally {
      if (completed) phase = "cleanup";
      input?.close();
      try {
        if (app?.server) await app.stop(true);
      } finally {
        try {
          await commands;
          if (proof) await proof.cleanupFixtures();
        } finally {
          try { await proof?.close(); }
          finally {
            clearTimeout(gracefulDeadline);
            clearTimeout(hardDeadline);
            process.removeListener("SIGTERM", stop);
            process.removeListener("SIGINT", stop);
          }
        }
      }
    }
    process.stdout.write("PASS identity browser fixture cleanup and close\n");
    return 0;
  } catch {
    process.stderr.write(`Identity browser fixture unavailable (${phase}); details suppressed.\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runIdentityBrowserServer();
