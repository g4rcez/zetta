import { expect, test } from "bun:test";
import {
  IdentityTestTargetError,
  requireIdentityTestTarget,
  type IdentityTestTargetEnvironment,
} from "./identity-test-target";

// Entirely synthetic placeholders; no environment or credential files are read.
const target = "postgresql://fixture_user:fixture_password@localhost/zetta_identity_test";
const normalizedTarget = "postgresql://fixture_user:fixture_password@localhost:5432/zetta_identity_test";
const optedIn = {
  ZETTA_TEST_DATABASE_URL: target,
  ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests",
};
const safeMessage = "Identity database test target is unavailable or unsafe.";

function denied(env: IdentityTestTargetEnvironment) {
  let error: unknown;
  try {
    requireIdentityTestTarget(env);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(IdentityTestTargetError);
  const failure = error as IdentityTestTargetError;
  expect(failure.message).toBe(safeMessage);
  expect(failure.name).toBe("IdentityTestTargetError");
  expect(failure.cause).toBeUndefined();
  expect(String(failure)).toBe(`IdentityTestTargetError: ${safeMessage}`);
  expect(JSON.stringify(failure)).toBe('{"name":"IdentityTestTargetError"}');
}

test("identity-test-target fails closed on absent target or non-exact mutation acknowledgement", () => {
  for (const env of [{}, { DATABASE_URL: target }, { ZETTA_TEST_DATABASE_URL: target },
    { ZETTA_TEST_DATABASE_ALLOW_MUTATION: "identity-tests" },
    { ...optedIn, ZETTA_TEST_DATABASE_URL: "" }]) {
    denied(env);
  }
  for (const optIn of [undefined, "", "true", "1", "IDENTITY-TESTS", " identity-tests", "identity-tests\n"]) {
    denied({ ...optedIn, ZETTA_TEST_DATABASE_ALLOW_MUTATION: optIn });
  }
});

test("identity-test-target accepts loopback formats and returns only a frozen endpoint-pinned connection string", () => {
  const cases = [
    [target, normalizedTarget],
    ["postgres://127.0.0.1:5432/zetta_identity_test", "postgres://127.0.0.1:5432/zetta_identity_test"],
    ["postgres://fixture_user:@localhost/zetta_identity_test", "postgres://fixture_user@localhost:5432/zetta_identity_test"],
    ["postgres://:fixture_password@localhost/zetta_identity_test", "postgres://:fixture_password@localhost:5432/zetta_identity_test"],
    ["POSTGRESQL://fixture_user:fixture_password@LOCALHOST:55432/zetta_identity_test",
      "postgresql://fixture_user:fixture_password@LOCALHOST:55432/zetta_identity_test"],
    ["postgresql://fixture_user:fixture_password@[::1]/zetta_identity_test",
      "postgresql://fixture_user:fixture_password@[::1]:5432/zetta_identity_test"],
    ["postgres://[::1]:55432/zetta_identity_test", "postgres://[::1]:55432/zetta_identity_test"],
    ["postgres://fixture%40user:fixture%3Apassword@localhost:05432/zetta_identity_test",
      "postgres://fixture%40user:fixture%3Apassword@localhost:5432/zetta_identity_test"],
  ] as const;
  for (const [url, expected] of cases) {
    const env = Object.freeze({ ...optedIn, ZETTA_TEST_DATABASE_URL: url });
    const result = requireIdentityTestTarget(env);
    expect(result).toEqual({ connectionString: expected });
    expect(Object.isFrozen(result)).toBe(true);
    expect(env.ZETTA_TEST_DATABASE_URL).toBe(url);
  }
});

test("identity-test-target rejects remote, alternate host, protocol, port and non-exact database forms", () => {
  for (const url of [
    "postgres://remote.invalid/zetta_identity_test",
    "postgres://localhost.remote.invalid/zetta_identity_test",
    "postgres://localhost./zetta_identity_test",
    "postgres://127.1/zetta_identity_test",
    "postgres://2130706433/zetta_identity_test",
    "postgres://127.0.0.2/zetta_identity_test",
    "postgres://[0:0:0:0:0:0:0:1]/zetta_identity_test",
    "postgres://[::ffff:127.0.0.1]/zetta_identity_test",
    "postgres://%6cocalhost/zetta_identity_test",
    "postgres://[::1%25lo0]/zetta_identity_test",
    "postgres://localhost:/zetta_identity_test",
    "postgres://localhost:0/zetta_identity_test",
    "postgres://localhost:65536/zetta_identity_test",
    "postgres://localhost:-1/zetta_identity_test",
    "postgres://localhost:port/zetta_identity_test",
    "https://localhost/zetta_identity_test",
    "file:///zetta_identity_test",
    "postgresql:localhost/zetta_identity_test",
    "postgres://localhost/zetta",
    "postgres://localhost/ZETTA_IDENTITY_TEST",
    "postgres://localhost/",
    "postgres://localhost",
    "postgres:///zetta_identity_test",
    "not a URL",
  ]) denied({ ...optedIn, ZETTA_TEST_DATABASE_URL: url });
});

test("identity-test-target rejects query, fragment, multi-host, normalization and encoded path tricks", () => {
  for (const url of [
    `${target}?`, `${target}?sslmode=disable`, `${target}?host=remote.invalid`,
    `${target}?dbname=zetta`, `${target}#`, `${target}#fragment`,
    `${target}/`, `${target}/extra`, `${target}%2fextra`, `${target}%00`,
    "postgres://localhost/%7Aetta_identity_test",
    "postgres://localhost/./zetta_identity_test",
    "postgres://localhost/other/../zetta_identity_test",
    "postgres://localhost//zetta_identity_test",
    "postgres://localhost,remote.invalid/zetta_identity_test",
    "postgres://localhost:5432,localhost:5433/zetta_identity_test",
    "postgres://remote.invalid@fixture_user:fixture_password@localhost/zetta_identity_test",
    "postgres://localhost%2cremote.invalid/zetta_identity_test",
    "postgres://fixture_user:%zz@localhost/zetta_identity_test",
    "postgres://localhost\\remote.invalid/zetta_identity_test",
    ` ${target}`, `${target} `, `${target}\n`, `${target}\r\n`,
    target.replace("localhost", "local\nhost"), target.replace("localhost", "local\thost"),
    target.replace("localhost", "local\u0000host"),
    target.replace("fixture_user", "fixture\u0000user"),
    target.replace("fixture_password", "fixture\u0001password"),
    target.replace("fixture_password", "fixture\u007fpassword"),
  ]) denied({ ...optedIn, ZETTA_TEST_DATABASE_URL: url });
});

test("identity-test-target denies application-equivalent endpoint/database independent of authentication and URL spelling", () => {
  for (const application of [target,
    "postgres://other_user:other_password@LOCALHOST:5432/zetta_identity_test",
    "POSTGRESQL://127.0.0.1/zetta_identity_test",
    "postgres://[::1]:05432/zetta_identity_test",
    "postgres://[0:0:0:0:0:0:0:1]/zetta_identity_test",
    "postgres://localhost./zetta_identity_test",
    "postgres://127.1/zetta_identity_test",
    "postgres://2130706433/zetta_identity_test",
    "postgres://localhost/%7Aetta_identity_test",
  ]) denied({ ...optedIn, DATABASE_URL: application });

  // Equivalence also applies when the test target uses IPv6 or a non-default port.
  denied({ ...optedIn, ZETTA_TEST_DATABASE_URL: "postgres://[::1]:55432/zetta_identity_test",
    DATABASE_URL: "postgresql://fixture_user:fixture_password@127.0.0.1:055432/zetta_identity_test" });
});

test("identity-test-target does not collapse different ports or PostgreSQL database identifiers", () => {
  for (const application of [
    "postgres://localhost/zetta",
    "postgres://localhost/ZETTA_IDENTITY_TEST",
    "postgres://localhost:55432/zetta_identity_test",
    "postgres://remote.invalid/zetta_identity_test",
  ]) {
    expect(requireIdentityTestTarget({ ...optedIn, DATABASE_URL: application })).toEqual({ connectionString: normalizedTarget });
  }
});

test("identity-test-target fails closed if a supplied application URL cannot be unambiguously compared", () => {
  for (const application of ["", "not a URL", "https://localhost/zetta",
    "postgres://localhost/zetta?sslmode=require", "postgres://localhost/zetta?host=remote.invalid",
    "postgres://localhost/zetta#", "postgres://localhost,remote.invalid/zetta",
    "postgres://localhost/other/../zetta_identity_test", "postgres://localhost/%zz",
    "postgres://fixture_user:%zz@localhost/zetta", "postgres://localhost:65536/zetta",
    `postgres://localhost/zetta\n`, "postgres://%6cocalhost/zetta_identity_test",
    ...[".", "..", "%2e", "%2e%2e", ".%2e", "%2e."].map(
      (path) => `postgres://zetta_identity_test:fixture_password@localhost:5432/${path}`,
    ),
  ]) {
    denied({ ...optedIn, DATABASE_URL: application });
  }
});

test("identity-test-target sanitizes unexpected injected-record/parser failures without a cause", () => {
  const failure = new Error("synthetic_private_cause");
  denied({ get ZETTA_TEST_DATABASE_URL(): string { throw failure; } });
  for (const env of [null, undefined, { ...optedIn, ZETTA_TEST_DATABASE_URL: 123 },
    { ...optedIn, DATABASE_URL: null }]) {
    denied(env as unknown as IdentityTestTargetEnvironment);
  }
});

test("identity-test-target imports and validates offline without ambient environment, startup or logging", async () => {
  const script = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Forbidden identity target side effect"); };
    Bun.serve = forbidden;
    Bun.connect = forbidden;
    net.Socket.prototype.connect = forbidden;
    tls.connect = forbidden;
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    console.log = console.warn = console.error = console.info = console.debug = forbidden;
    Object.defineProperty(process, "env", { get: forbidden });
    const { requireIdentityTestTarget, IdentityTestTargetError } = await import(${JSON.stringify(new URL("./identity-test-target.ts", import.meta.url).href)});
    const result = requireIdentityTestTarget(${JSON.stringify(optedIn)});
    if (result.connectionString !== ${JSON.stringify(normalizedTarget)}) throw new Error("Missing validated target");
    try {
      requireIdentityTestTarget({});
      throw new Error("Missing configuration unexpectedly accepted");
    } catch (error) {
      if (!(error instanceof IdentityTestTargetError)) throw error;
    }
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const source = await Bun.file(new URL("./identity-test-target.ts", import.meta.url)).text();
  expect(source).not.toMatch(/\bimport\b|\brequire\s*\(|\bprocess\b|\bBun\b|\bconsole\b|\bfetch\b|\bPool\b/);
});
