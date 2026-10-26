import { expect, test } from "bun:test";

test("browser harness import is inert and missing target fails before timers, sockets or auth", async () => {
  const entry = new URL("./identity-browser-server.ts", import.meta.url).href;
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    import dns from "node:dns";
    const forbidden = () => { throw new Error("Unexpected startup"); };
    net.Socket.prototype.connect = forbidden;
    net.Server.prototype.listen = forbidden;
    tls.connect = forbidden;
    dns.lookup = forbidden;
    Bun.connect = forbidden;
    Bun.listen = forbidden;
    Bun.serve = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const { runIdentityBrowserServer } = await import(${JSON.stringify(entry)});
    if (process.exitCode) throw new Error("Import was not inert");
    process.exitCode = await runIdentityBrowserServer();
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "development" }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code === 1 && out === "" && err === "Identity browser fixture unavailable (target validation); details suppressed.\n").toBe(true);
});

test("browser harness keeps fixed seed/control and production security composition", async () => {
  const source = await Bun.file(new URL("./identity-browser-server.ts", import.meta.url)).text();
  expect(source.indexOf("requireIdentityAuthProofTarget(process.env)")).toBeLessThan(source.indexOf("await import("));
  expect(source.indexOf("proof = await openIdentityProof")).toBeLessThan(source.indexOf('await import("better-auth")'));
  expect(source).toContain("createOperatorCredentialProvisioner");
  expect(source).toContain("createAuthOptions(config, owned.firstDb");
  expect(source).toContain("createIdentityAccess(auth, createMembershipLookup(owned.firstDb))");
  expect(source).toContain('if (line !== "remove-member")');
  expect(source).toContain("email='browser-member@identity.invalid'");
  expect(source).toContain("await app.stop(true)");
  expect(source).toContain("await proof.cleanupFixtures()");
  expect(source).toContain("await proof?.close()");
  expect(source).toContain("15 * 60_000");
  expect(source).toContain('BETTER_AUTH_URL: "http://localhost:3002"');
  expect(source).toContain('app.listen({ hostname: "127.0.0.1", port: 3002 })');
  expect(source).not.toMatch(/env.server|from ["'].*services|disableCSRFCheck|disableOriginCheck|defaultCookieAttributes|useSecureCookies/);
});
