import { expect, test } from "bun:test";
import { parseCredentialOperatorInput } from "./credential-operator";

test("closed credential input rejects authority and caller-selected identity", () => {
  // Given a valid credential body with an additional authority field.
  const credentials = { name: "Operator", email: "operator@example.invalid", password: "synthetic-password" };
  // When parsed, then each additional field must deny.
  for (const extra of [{ role: "admin" }, { userId: "chosen" }, { newAdminUserId: "chosen" }, { emailVerified: true }]) {
    expect(() => parseCredentialOperatorInput("bootstrap", JSON.stringify({ ...credentials, ...extra }))).toThrow();
  }
});

import { runCredentialOperator } from "./credential-operator";
import type { CredentialOperatorDependencies } from "./credential-operator";
import { readOperatorInput } from "./admin-operator";
const env = { ZETTA_OPERATOR_DATABASE_URL: "postgres://operator:synthetic@127.0.0.1:55432/identity_local", ZETTA_OPERATOR_ALLOW_MUTATION: "identity-admin" };
const body = { name: "Operator", email: "operator@example.invalid", password: "synthetic-password" };
function fixture(fault?: string) {
  const calls: unknown[] = [], stdout: string[] = [], stderr: string[] = [];
  let expire = () => {};
  let closed = false;
  const fail = (phase: string) => { if (fault === phase) throw new Error("PRIVATE detail"); };
  const deps: CredentialOperatorDependencies = {
    isTTY: () => fault === "tty",
    readInput: async () => { calls.push("input"); fail("input"); return JSON.stringify(body); },
    startDeadline: (callback) => { expire = callback; calls.push("timer"); return () => { calls.push("stop"); }; },
    terminate: () => { calls.push("terminate"); },
    open: async () => {
      calls.push("open"); fail("connection");
      return {
        provision: async (input) => {
          calls.push(["provision", input]); fail("provisioning");
          if (fault === "deadline-provision") expire();
          return fault === "denied" ? { ok: false, code: "provisioning_failed" } : { ok: true, userId: "verified-id" };
        },
        service: {
          bootstrapExistingAccount: async (input) => { calls.push(["bootstrap", input]); fail("activation"); return { adminUserId: "verified-id" }; },
          replaceAdminWithExistingAccount: async (input) => { calls.push(["replace", input]); fail("activation"); return { previousAdminUserId: "old", adminUserId: "verified-id" }; },
        },
        healthy: () => { calls.push("healthy"); if (closed) fail("late-health"); },
        close: async () => { calls.push("close"); closed = true; if (fault === "deadline-close") expire(); fail("cleanup"); },
      };
    },
    stdout: (text) => { stdout.push(text); }, stderr: (text) => { stderr.push(text); },
  };
  return { deps, calls, stdout, stderr };
}

test("bootstrap uses verified ID only and closes before success", async () => {
  const f = fixture();
  const result = await runCredentialOperator(["bootstrap"], env, f.deps);
  expect(result).toBe(0);
  expect(f.calls).toEqual(["timer", "input", "open", "healthy", ["provision", body], "healthy", ["bootstrap", { userId: "verified-id" }], "healthy", "close", "healthy", "stop"]);
  expect(f.stdout).toEqual(["Credential operator completed.\n"]);
  expect(f.stderr).toEqual([]);
});
test("replacement strips lifecycle fields from signup and uses verified ID", async () => {
  const f = fixture();
  f.deps.readInput = async () => JSON.stringify({ ...body, expectedAdminUserId: "old", reason: "planned-transfer" });
  const result = await runCredentialOperator(["replace"], env, f.deps);
  expect(result).toBe(0);
  expect(f.calls).toContainEqual(["provision", body]);
  expect(f.calls).toContainEqual(["replace", { expectedAdminUserId: "old", newAdminUserId: "verified-id", reason: "planned-transfer" }]);
});
test("configuration denies ambient selectors and invalid commands before any resource", async () => {
  for (const key of ["PGHOST", "pgservice", "NODE_PG_FORCE_NATIVE", "BETTER_AUTH_TELEMETRY", "BETTER_AUTH_TELEMETRY_DEBUG", "BETTER_AUTH_TELEMETRY_URL"]) {
    const f = fixture();
    expect(await runCredentialOperator(["bootstrap"], { ...env, [key]: "" }, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
  }
  for (const args of [[], ["signup"], ["bootstrap", "--password=private"], ["--help", "replace"]]) {
    const f = fixture();
    expect(await runCredentialOperator(args, env, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
  }
  const f = fixture("tty");
  expect(await runCredentialOperator(["bootstrap"], env, f.deps)).toBe(1);
  expect(f.calls).toEqual([]);
});
test("help ignores invalid configuration and never starts resources", async () => {
  const f = fixture();
  expect(await runCredentialOperator(["--help"], {}, f.deps)).toBe(0);
  expect(f.calls).toEqual([]);
  expect(f.stdout.join("")).toContain("Usage:");
});
test("provision denial never activates, retries or adopts an identity", async () => {
  const f = fixture("denied");
  expect(await runCredentialOperator(["bootstrap"], env, f.deps)).toBe(1);
  expect(f.calls.filter(Array.isArray)).toEqual([["provision", body]]);
  expect(f.calls.slice(-3)).toEqual(["close", "healthy", "stop"]);
  expect(f.stderr).toEqual(["Credential operator unavailable (provisioning).\n"]);
});
test("failure phases suppress private causes and always close an acquired client", async () => {
  for (const fault of ["input", "connection", "provisioning", "activation", "cleanup", "late-health"]) {
    const f = fixture(fault);
    expect(await runCredentialOperator(["bootstrap"], env, f.deps)).toBe(1);
    expect(f.stdout).toEqual([]);
    expect(f.stderr).toEqual([`Credential operator unavailable (${fault === "late-health" ? "cleanup" : fault}).\n`]);
    expect(f.calls.at(-1)).toBe("stop");
    expect(f.calls.includes("close")).toBe(!["input", "connection"].includes(fault));
  }
});
test("deadline remains active through provisioning and close and prevents success", async () => {
  for (const fault of ["deadline-provision", "deadline-close"]) {
    const f = fixture(fault);
    expect(await runCredentialOperator(["bootstrap"], env, f.deps)).toBe(1);
    expect(f.stdout).toEqual([]);
    expect(f.stderr).toEqual(["Credential operator unavailable (deadline).\n"]);
    expect(f.calls).toContain("terminate");
    expect(f.calls.at(-1)).toBe("stop");
    if (fault === "deadline-provision") expect(f.calls.filter(Array.isArray)).toEqual([["provision", body]]);
  }
});
test("invalid closed input never opens the driver", async () => {
  for (const input of ["{", JSON.stringify({ ...body, role: "admin" }), JSON.stringify({ ...body, password: "short" }), " ".repeat(4097)]) {
    const f = fixture();
    f.deps.readInput = async () => input;
    expect(await runCredentialOperator(["bootstrap"], env, f.deps)).toBe(1);
    expect(f.calls).toEqual(["timer", "stop"]);
    expect(f.stderr).toEqual(["Credential operator unavailable (input).\n"]);
  }
});
test("replacement input requires exact ID and allowlisted reason", () => {
  for (const patch of [{ expectedAdminUserId: " old" }, { expectedAdminUserId: "old\n" }, { reason: "secret explanation" }, { reason: "" }]) {
    expect(() => parseCredentialOperatorInput("replace", JSON.stringify({ ...body, expectedAdminUserId: "old", reason: "planned-transfer", ...patch }))).toThrow();
  }
});
test("shared stream input preserves split UTF8 and rejects overflow", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...body, name: "É" }));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  expect(parseCredentialOperatorInput("bootstrap", await readOperatorInput(stream, new AbortController().signal)).input.name).toBe("É");
  const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4097)); controller.close(); } });
  await expect(readOperatorInput(oversized, new AbortController().signal)).rejects.toThrow();
});
test("real executable help, rejected input and inert import remain offline", async () => {
  const cli = new URL("./credential-operator-cli.ts", import.meta.url).pathname;
  for (const scenario of ["help", "badinput", "import"]) {
    const script = scenario === "import" ? `await import(${JSON.stringify(cli)});` : `process.argv = ['bun', ${JSON.stringify(cli)}, ${JSON.stringify(scenario === "help" ? "--help" : "bootstrap")}]; await import(${JSON.stringify(cli)});`;
    const child = scenario === "import"
      ? Bun.spawn([process.execPath, "--no-env-file", "-e", `const deny=()=>{throw new Error('Unexpected IO')}; globalThis.fetch=deny; globalThis.setTimeout=deny; const net=await import('node:net'); net.Socket.prototype.connect=deny; ${script}`], { env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe" })
      : Bun.spawn([process.execPath, "--no-env-file", cli, scenario === "help" ? "--help" : "bootstrap"], { env: scenario === "help" ? {} : env, stdin: new Blob(['{"password":"PRIVATE"}']), stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(scenario === "badinput" ? 1 : 0);
    expect(await new Response(child.stderr).text()).toBe(scenario === "badinput" ? "Credential operator unavailable (input).\n" : "");
    const output = await new Response(child.stdout).text();
    expect(scenario === "help" ? output.startsWith("Usage:") : output === "").toBe(true);
  }
});
