import { expect, test } from "bun:test";
import { IdentityTestTargetError } from "./identity-test-target";
import { requireIdentityProofTarget } from "./identity-proof-target";

const fixture = {
  ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
  ZETTA_TEST_DATABASE_URL: "postgresql://zetta_identity_runner:synthetic@127.0.0.1:55432/zetta_identity_test",
};
function denied(env: Record<string, string | undefined>) {
  try {
    requireIdentityProofTarget(env);
    throw new Error("Expected denial");
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityTestTargetError);
    expect((error as Error).message).toBe("Identity database test target is unavailable or unsafe.");
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  }
}
test("identity-proof-target pins dedicated Compose credentials and normalized endpoint", () => {
  expect(requireIdentityProofTarget(fixture).connectionString).toBe(fixture.ZETTA_TEST_DATABASE_URL);
  expect(requireIdentityProofTarget({ ...fixture,
    ZETTA_TEST_DATABASE_URL: fixture.ZETTA_TEST_DATABASE_URL.replace(":55432", ":055432"),
  }).connectionString).toBe(fixture.ZETTA_TEST_DATABASE_URL);
});
test("identity-proof-target denies missing opt-in/target, non-dedicated credentials and ambient PG settings", () => {
  denied({});
  denied({ ...fixture, ZETTA_TEST_DATABASE_ALLOW_MUTATION: undefined });
  denied({ ...fixture, ZETTA_TEST_DATABASE_URL: undefined });
  denied({ ...fixture, DATABASE_URL: fixture.ZETTA_TEST_DATABASE_URL });
  for (const replacement of ["localhost:55432", "127.0.0.1:5432", "[::1]:55432"]) {
    denied({ ...fixture, ZETTA_TEST_DATABASE_URL: fixture.ZETTA_TEST_DATABASE_URL.replace("127.0.0.1:55432", replacement) });
  }
  for (const credentials of ["zetta_identity_runner", "zetta_identity_runner:", ":synthetic", "postgres:synthetic"]) {
    denied({ ...fixture, ZETTA_TEST_DATABASE_URL: fixture.ZETTA_TEST_DATABASE_URL.replace("zetta_identity_runner:synthetic", credentials) });
  }
  for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPASSFILE", "PGSERVICE",
    "PGSERVICEFILE", "PGSSLMODE", "PGSSLNEGOTIATION", "PGOPTIONS", "PGAPPNAME", "PGCONNECT_TIMEOUT",
    "PGCLIENT_ENCODING", "PGREPLICATION", "PGQUERY_TIMEOUT", "PGUNKNOWN", "pgHost", "NODE_PG_FORCE_NATIVE"]) {
    denied({ ...fixture, [key]: "synthetic" });
    denied({ ...fixture, [key]: "" });
  }
});
test("identity proof entry guard precedes dynamic runtime imports and has no automatic test filename", async () => {
  const source = await Bun.file(new URL("../modules/identity/enrollment.integration.ts", import.meta.url)).text();
  expect(source.indexOf("requireIdentityProofTarget(process.env)")).toBeLessThan(source.indexOf("await import("));
  expect(source).not.toContain('from "@zetta/db');
  expect(source).not.toContain("varlock");
  expect(source).not.toContain("bun:test");
  expect(source.indexOf('await import("./enrollment-races.integration")')).toBeGreaterThan(
    source.indexOf("proof = await openIdentityProof(target.connectionString)"));
  expect(source).toContain("PASS identity database proof (14 checks)");
});
test("invitation race extension import is inert without a proof client", async () => {
  const extension = new URL("../modules/identity/enrollment-races.integration.ts", import.meta.url).href;
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Unexpected IO or startup"); };
    net.Socket.prototype.connect = forbidden;
    net.Server.prototype.listen = forbidden;
    tls.connect = forbidden;
    Bun.connect = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    const extension = await import(${JSON.stringify(extension)});
    if (typeof extension.runInvitationRaces !== "function") throw new Error("Missing test runner");
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(0);
  expect(out).toBe("");
  expect(err).toBe("");
});
test("missing identity proof target fails before any runtime client import or IO", async () => {
  const entry = new URL("../modules/identity/enrollment.integration.ts", import.meta.url).href;
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Unexpected network"); };
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    Bun.connect = forbidden;
    globalThis.fetch = forbidden;
    await import(${JSON.stringify(entry)});
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(1);
  expect(out).toBe("");
  expect(err).toBe("Identity database proof failed at target validation; details suppressed.\n");
});
