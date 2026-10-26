import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/verify-identity-auth.sh");

// Shell control-flow fixtures only: no real Docker, Bun child, auth or database.
async function runFixture(overrides: Record<string, string> = {}, args: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "zetta-auth-launcher-"));
  try {
    await writeFile(join(directory, "docker"), `#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == container || "$1" == network || "$1" == volume ]]; then
  if [[ "\${MOCK_EXISTING:-}" == "$1" ]]; then printf 'existing-resource\\n'; fi
elif [[ "$1" == inspect ]]; then
  printf '{}\\n'
elif [[ "$1" == exec ]]; then
  printf '%s\\n' "\${MOCK_FILESYSTEM:-tmpfs}"
elif [[ "$*" == *' up '* ]]; then
  exit "\${MOCK_START_EXIT:-0}"
elif [[ "$*" == *' ps '* ]]; then
  printf 'new-test-container\\n'
fi
`, { mode: 0o700 });
    await writeFile(join(directory, "bun"), `#!/bin/bash
if [[ "$2" == ./* ]]; then
  printf 'proof-argv'; printf ' <%s>' "$@"; printf '\\n';
fi >> "$MOCK_LOG"
case "$*" in
  *getRandomValues*) printf '${"a".repeat(64)}\\n';;
  *requireIdentityAuthProofTarget*) exit "\${MOCK_GUARD_EXIT:-0}";;
  *Bun.stdin.json*) while IFS= read -r line; do :; done; exit "\${MOCK_INSPECT_EXIT:-0}";;
  *identity-lock-order.integration.ts*) printf 'identity-lock-order-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *identity-lock-positive.integration.ts*) printf 'identity-lock-positive-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *dispatch-schema.integration.ts*) printf 'dispatch-schema-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *identity-activation.integration.ts*) printf 'activation-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *signup.integration.ts*) printf 'proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *admin-operator.integration.ts*) printf 'operator-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *credential-provisioning.integration.ts*) printf 'credentials-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *credential-operator.integration.ts*) printf 'credential-operator-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *connections/store.integration.ts*) printf 'connection-store-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *connections/schema.integration.ts*) printf 'connection-schema-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *runtime/run-schema.integration.ts*) printf 'run-schema-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *runtime/run-provenance-diagnostic.integration.ts*) printf 'run-provenance-diagnostic-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *runtime/runs.integration.ts*) printf 'run-store-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *runtime/runs-restart.integration.ts*) printf 'run-restart-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *identity-browser-server.ts*) printf 'browser-proof\\n' >> "$MOCK_LOG"; exit "\${MOCK_PROOF_EXIT:-0}";;
  *) exit 99;;
esac
`, { mode: 0o700 });
    const result = Bun.spawnSync(["/bin/bash", script, ...args], {
      cwd: root,
      env: { ...process.env, ...overrides, PATH: `${directory}:/usr/bin:/bin`, MOCK_LOG: join(directory, "calls") },
      timeout: 5000,
    });
    const calls = await Bun.file(join(directory, "calls")).exists() ? await readFile(join(directory, "calls"), "utf8") : "";
    return { exit: result.exitCode, calls, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("identity auth launcher parses and pins disposable Compose, no application env or pull", async () => {
  expect(Bun.spawnSync(["/bin/bash", "-n", script]).exitCode).toBe(0);
  const source = await readFile(script, "utf8");
  expect(source).toContain("--env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests");
  expect(source).toContain("--pull never --wait --wait-timeout 60");
  expect(source).toContain("ZETTA_TEST_DATABASE_ALLOW_MUTATION=identity-tests");
  expect(source).toContain("set +x");
  expect(source).not.toMatch(/down[^\n]*(?:--volumes| -v)|db:push|prune/);
});

test("identity launcher dispatches only its fixed operator mode and rejects unknown modes before Docker", async () => {
  const operator = await runFixture({}, ["operator"]);
  expect(operator.exit).toBe(0);
  expect(operator.calls).toContain("\noperator-proof\n");
  expect(operator.calls).not.toContain("\nproof\n");
  expect(operator.calls).toContain("down --timeout 5");
  const failed = await runFixture({ MOCK_PROOF_EXIT: "1" }, ["operator"]);
  expect(failed.exit).toBe(1);
  expect(failed.calls).toContain("down --timeout 5");
  for (const args of [["arbitrary.ts"], ["operator", "extra"]]) {
    const denied = await runFixture({}, args);
    expect(denied.exit).toBe(1);
    expect(denied.calls).toBe("");
  }
});

test("identity auth launcher refuses existing containers, networks or volumes without mutation", async () => {
  for (const resource of ["container", "network", "volume"]) {
    const result = await runFixture({ MOCK_EXISTING: resource });
    expect(result.exit).toBe(1);
    expect(result.calls).not.toMatch(/^(?:compose|proof)(?: |$)/m);
    expect(result.stderr).toContain("refusing to reuse or delete");
  }
});

test("identity auth launcher denies unsafe environment before Compose provisioning", async () => {
  const result = await runFixture({ MOCK_GUARD_EXIT: "1" });
  expect(result.exit).toBe(1);
  expect(result.calls).not.toMatch(/^(?:compose|proof)(?: |$)/m);
});

test("identity auth launcher tears down on startup, ownership or auth failure and preserves failure", async () => {
  for (const key of ["MOCK_START_EXIT", "MOCK_INSPECT_EXIT", "MOCK_FILESYSTEM", "MOCK_PROOF_EXIT"]) {
    const result = await runFixture({ [key]: key === "MOCK_FILESYSTEM" ? "ext4" : "1" });
    expect(result.exit).toBe(1);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout).toContain("PASS dedicated Compose container/network cleanup");
    if (key !== "MOCK_PROOF_EXIT") expect(result.calls).not.toContain("\nproof\n");
    expect(result.stdout + result.stderr).not.toContain("a".repeat(64));
  }
});

test("identity auth launcher completes proof and cleanup without exposing throwaway credentials", async () => {
  const result = await runFixture();
  expect(result.exit).toBe(0);
  expect(result.calls).toContain("\nproof\n");
  expect(result.calls).toContain("down --timeout 5");
  expect(result.stdout).toContain("PASS dedicated Compose container/network cleanup");
  expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
});

test("identity auth metadata accepts Docker HostConfig tmpfs with empty Mounts but rejects unsafe metadata", async () => {
  const source = await readFile(script, "utf8");
  const validator = source.match(/\| bun --no-env-file -e '([\s\S]+?)'\n/)?.[1];
  expect(validator).toBeDefined();
  const valid = {
    project: "zetta-identity-tests", service: "postgres", health: "healthy",
    ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] },
    tmpfs: { "/var/lib/postgresql": "size=268435456,mode=0755" }, mounts: [],
  };
  const cases: [object, number][] = [
    [valid, 0], [{ ...valid, mounts: [{ Type: "tmpfs" }] }, 0],
    [{ ...valid, tmpfs: {} }, 1], [{ ...valid, mounts: [{ Type: "bind" }] }, 1],
    [{ ...valid, mounts: [{ Type: "volume" }] }, 1], [{ ...valid, mounts: null }, 1],
    [{ ...valid, project: "application" }, 1], [{ ...valid, health: "unhealthy" }, 1],
    [{ ...valid, ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55432" }] } }, 1],
  ];
  for (const [metadata, exit] of cases) {
    // Actual extracted predicate, not the fake Bun used for shell control flow.
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", validator!], {
      stdin: Buffer.from(JSON.stringify(metadata)), timeout: 5000,
    });
    expect(result.exitCode).toBe(exit);
  }
});


test("credentials mode selects only its proof and preserves failing proof exit through teardown", async () => {
  for (const exit of [0, 1]) {
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["credentials"]);
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter((line) => line.endsWith("proof"))).toEqual(["credentials-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout).toContain("PASS dedicated Compose container/network cleanup");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
  const extra = await runFixture({}, ["credentials", "extra"]);
  expect(extra.exit).toBe(1);
  expect(extra.calls).toBe("");
});

test("browser mode selects only its fixed runner and tears down on success or failure", async () => {
  for (const exit of [0, 1]) {
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["browser"]);
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter((line) => line.endsWith("proof"))).toEqual(["browser-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout).toContain("PASS dedicated Compose container/network cleanup");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
  const deniedEnvironments: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of deniedEnvironments) {
    const result = await runFixture(overrides, ["browser"]);
    expect(result.exit).toBe(1);
    expect(result.calls).not.toContain("browser-proof");
    expect(result.calls).not.toContain(" up ");
  }
  const extra = await runFixture({}, ["browser", "extra"]);
  expect(extra.exit).toBe(1);
  expect(extra.calls).toBe("");
});


test("credential-operator mode dispatches only its proof and always tears down", async () => {
  for (const exit of [0, 1]) {
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["credential-operator"]);
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter((line) => line.endsWith("proof"))).toEqual(["credential-operator-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
  const deniedEnvironments: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of deniedEnvironments) {
    const result = await runFixture(overrides, ["credential-operator"]);
    expect(result.exit).toBe(1);
    expect(result.calls).not.toContain("credential-operator-proof");
    expect(result.calls).not.toContain(" up ");
  }
  const extra = await runFixture({}, ["credential-operator", "extra"]);
  expect(extra.exit).toBe(1);
  expect(extra.calls).toBe("");
});


test("connection-schema mode selects its fixed proof and cleans up both outcomes", async () => {
  // Given a fixed connection schema mode and successful or failed proof.
  for (const exit of [0, 1]) {
    // When the actual shell is driven through the launcher fixture.
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["connection-schema"]);
    // Then it invokes only this proof and preserves its status through cleanup.
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter((line) => line.endsWith("proof"))).toEqual(["connection-schema-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
});

test("connection-schema mode denies existing resources and unsafe selectors before start", async () => {
  // Given ownership or target-guard refusal.
  const denied: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of denied) {
    // When the fixed mode is requested.
    const result = await runFixture(overrides, ["connection-schema"]);
    // Then no proof or provisioning occurs.
    expect(result.exit).toBe(1);
    expect(result.calls).not.toContain("connection-schema-proof");
    expect(result.calls).not.toContain(" up ");
  }
});

test("connection-schema mode rejects additional arguments before Docker", async () => {
  // Given an extra user-selected argument.
  // When the launcher parses it.
  const result = await runFixture({}, ["connection-schema", "extra"]);
  // Then nothing is provisioned or inspected.
  expect(result.exit).toBe(1);
  expect(result.calls).toBe("");
});

test("connection schema executable import is inert and unsafe target denies before database import", async () => {
  // Given no target settings and all startup/network entry points disabled.
  const body = `
    import net from 'node:net';
    import tls from 'node:tls';
    let attempts = 0;
    const forbidden = () => { attempts++; throw new Error('unexpected IO'); };
    net.Socket.prototype.connect = forbidden; net.Server.prototype.listen = forbidden; tls.connect = forbidden;
    Bun.connect = forbidden; Bun.listen = forbidden; Bun.serve = forbidden; globalThis.fetch = forbidden;
    const proof = await import(${JSON.stringify(new URL("../apps/server/src/modules/connections/schema.integration.ts", import.meta.url).href)});
    if (attempts !== 0 || process.exitCode) throw new Error('import was not inert');
    await proof.runConnectionSchemaProof();
    if (attempts !== 0 || process.exitCode !== 1) throw new Error('target guard did not deny safely');
  `;
  // When the actual executable is imported and explicitly invoked without a target.
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", body], { env: {}, timeout: 5000 });
  // Then the guard returns a fixed failure with zero network attempts and no proof output.
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("Connection schema proof failed at target validation; details suppressed.\n");
});


test("connection-store mode dispatches only its proof and preserves cleanup outcomes", async () => {
  // Given a successful or failed connection store proof.
  for (const exit of [0, 1]) {
    // When the fixed launcher mode executes under shell fixtures.
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["connection-store"]);
    // Then only its proof runs and cleanup preserves the result without credentials.
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter(line => line.endsWith("proof"))).toEqual(["connection-store-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
});

test("connection-store mode refuses existing resources unsafe environment and extra arguments", async () => {
  // Given ownership or target refusal, or an extra untrusted argument.
  const denied: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of denied) {
    // When the fixed mode is requested.
    const result = await runFixture(overrides, ["connection-store"]);
    // Then no proof or provisioning occurs.
    expect(result.exit).toBe(1); expect(result.calls).not.toContain("connection-store-proof"); expect(result.calls).not.toContain(" up ");
  }
  const extra = await runFixture({}, ["connection-store", "extra"]);
  expect(extra.exit).toBe(1); expect(extra.calls).toBe("");
});

test("connection store executable imports inertly and rejects unsafe target without IO", () => {
  // Given an empty environment and blocked network/startup surfaces.
  const body = `
    import net from 'node:net'; import tls from 'node:tls';
    let attempts = 0; const denied = () => { attempts++; throw new Error('unexpected IO'); };
    net.Socket.prototype.connect = denied; net.Server.prototype.listen = denied; tls.connect = denied;
    Bun.connect = denied; Bun.listen = denied; Bun.serve = denied; globalThis.fetch = denied;
    const proof = await import(${JSON.stringify(new URL("../apps/server/src/modules/connections/store.integration.ts", import.meta.url).href)});
    if (attempts !== 0 || process.exitCode) throw new Error('non-inert import');
    await proof.runConnectionStoreProof();
    if (attempts !== 0 || process.exitCode !== 1) throw new Error('unsafe target accepted');
  `;
  // When the actual entry point is imported then explicitly called.
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", body], { env: {}, timeout: 5000 });
  // Then only the fixed target-denial failure is returned.
  expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("Connection store proof failed at target validation; details suppressed.\n");
});

test("run-schema mode dispatches only its proof and preserves cleanup outcomes", async () => {
  // Given a successful or failed run schema proof.
  for (const exit of [0, 1]) {
    // When the fixed launcher mode executes under shell fixtures.
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["run-schema"]);
    // Then only its proof runs and cleanup preserves the result without credentials.
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter(line => line.endsWith("proof"))).toEqual(["run-schema-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
});

test("run-schema mode refuses existing resources unsafe environment and extra arguments", async () => {
  // Given ownership or target refusal, or an extra untrusted argument.
  const denied: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of denied) {
    // When the fixed mode is requested.
    const result = await runFixture(overrides, ["run-schema"]);
    // Then no proof or provisioning occurs.
    expect(result.exit).toBe(1); expect(result.calls).not.toContain("run-schema-proof"); expect(result.calls).not.toContain(" up ");
  }
  const extra = await runFixture({}, ["run-schema", "extra"]);
  expect(extra.exit).toBe(1); expect(extra.calls).toBe("");
});

test("run schema executable imports inertly and rejects unsafe target without IO", () => {
  // Given an empty environment and blocked network/startup surfaces.
  const body = `
    import net from 'node:net'; import tls from 'node:tls';
    let attempts = 0; const denied = () => { attempts++; throw new Error('unexpected IO'); };
    net.Socket.prototype.connect = denied; net.Server.prototype.listen = denied; tls.connect = denied;
    Bun.connect = denied; Bun.listen = denied; Bun.serve = denied; globalThis.fetch = denied;
    const proof = await import(${JSON.stringify(new URL("../apps/server/src/modules/runtime/run-schema.integration.ts", import.meta.url).href)});
    if (attempts !== 0 || process.exitCode) throw new Error('non-inert import');
    await proof.runRunSchemaProof();
    if (attempts !== 0 || process.exitCode !== 1) throw new Error('unsafe target accepted');
  `;
  // When the actual entry point is imported then explicitly called.
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", body], { env: {}, timeout: 5000 });
  // Then only the fixed target-denial failure is returned.
  expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("Run schema proof failed at target validation; details suppressed.\n");
});

test("run-store mode dispatches only its proof and preserves cleanup outcomes", async () => {
  // Given a successful or failed run store proof.
  for (const exit of [0, 1]) {
    // When the fixed launcher mode executes under shell fixtures.
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["run-store"]);
    // Then only its proof runs and cleanup preserves the result without credentials.
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter(line => line.endsWith("proof"))).toEqual(["run-store-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
});

test("run-store mode refuses existing resources unsafe environment and extra arguments", async () => {
  // Given ownership or target refusal, or an extra untrusted argument.
  const denied: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of denied) {
    // When the fixed mode is requested.
    const result = await runFixture(overrides, ["run-store"]);
    // Then no proof or provisioning occurs.
    expect(result.exit).toBe(1); expect(result.calls).not.toContain("run-store-proof"); expect(result.calls).not.toContain(" up ");
  }
  const extra = await runFixture({}, ["run-store", "extra"]);
  expect(extra.exit).toBe(1); expect(extra.calls).toBe("");
});

test("run store executable imports inertly and rejects unsafe target without IO", () => {
  // Given an empty environment and blocked network/startup surfaces.
  const body = `
    import net from 'node:net'; import tls from 'node:tls';
    let attempts = 0; const denied = () => { attempts++; throw new Error('unexpected IO'); };
    net.Socket.prototype.connect = denied; net.Server.prototype.listen = denied; tls.connect = denied;
    Bun.connect = denied; Bun.listen = denied; Bun.serve = denied; globalThis.fetch = denied;
    const proof = await import(${JSON.stringify(new URL("../apps/server/src/modules/runtime/runs.integration.ts", import.meta.url).href)});
    if (attempts !== 0 || process.exitCode) throw new Error('non-inert import');
    await proof.runOwnedRunStoreProof();
    if (attempts !== 0 || process.exitCode !== 1) throw new Error('unsafe target accepted');
  `;
  // When the actual entry point is imported then explicitly called.
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", body], { env: {}, timeout: 5000 });
  // Then only the fixed target-denial failure is returned.
  expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("Run store proof failed at target validation; details suppressed.\n");
});

test("run-restart mode dispatches only its proof and preserves cleanup outcomes", async () => {
  // Given a successful or failed run restart proof.
  for (const exit of [0, 1]) {
    // When the fixed launcher mode executes under shell fixtures.
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["run-restart"]);
    // Then only its proof runs and cleanup preserves the result without credentials.
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter(line => line.endsWith("proof"))).toEqual(["run-restart-proof"]);
    expect(result.calls).toContain("down --timeout 5");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
});

test("run-restart mode refuses existing resources unsafe environment and extra arguments", async () => {
  // Given ownership or target refusal, or an extra untrusted argument.
  const denied: Record<string, string>[] = [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }];
  for (const overrides of denied) {
    // When the fixed mode is requested.
    const result = await runFixture(overrides, ["run-restart"]);
    // Then no proof or provisioning occurs.
    expect(result.exit).toBe(1); expect(result.calls).not.toContain("run-restart-proof"); expect(result.calls).not.toContain(" up ");
  }
  const extra = await runFixture({}, ["run-restart", "extra"]);
  expect(extra.exit).toBe(1); expect(extra.calls).toBe("");
});

test("run restart executable imports inertly and rejects unsafe target without IO", () => {
  // Given an empty environment and blocked network/startup surfaces.
  const body = `
    import net from 'node:net'; import tls from 'node:tls';
    let attempts = 0; const denied = () => { attempts++; throw new Error('unexpected IO'); };
    net.Socket.prototype.connect = denied; net.Server.prototype.listen = denied; tls.connect = denied;
    Bun.connect = denied; Bun.listen = denied; Bun.serve = denied; globalThis.fetch = denied;
    const proof = await import(${JSON.stringify(new URL("../apps/server/src/modules/runtime/runs-restart.integration.ts", import.meta.url).href)});
    if (attempts !== 0 || process.exitCode) throw new Error('non-inert import');
    await proof.runRestartProof();
    if (attempts !== 0 || process.exitCode !== 1) throw new Error('unsafe target accepted');
  `;
  // When the actual entry point is imported then explicitly called.
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", body], { env: {}, timeout: 5000 });
  // Then only the fixed target-denial failure is returned.
  expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("Run restart proof failed at target validation; details suppressed.\n");
});


test("restart IPC parser rejects extra fields and oversized private messages", async () => {
  const { parseRestartMessage } = await import("../apps/server/src/modules/runtime/runs-restart.integration");
  for (const value of ["{}", "x".repeat(16385), JSON.stringify({ kind: "committed", unexpected: true })]) {
    expect(() => parseRestartMessage(value)).toThrow("Restart message unavailable.");
  }
});


test("restart IPC accepts one valid committed shape and rejects additions or identity mismatch", async () => {
  const { parseRestartMessage } = await import("../apps/server/src/modules/runtime/runs-restart.integration");
  const id = "00000000-0000-4000-8000-000000000001";
  const dto = { id, revision: 4, origin: "interactive", botId: "bot", conversationId: "conversation", configurationId: "configuration", configurationVersion: 1,
    status: "succeeded", attemptId: id, generation: 1, effectState: "known", createdAtMs: 1, startedAtMs: 2, finishedAtMs: 3, cancelRequestedAtMs: null };
  const result = { runId: id, attemptId: id, generation: 1, status: "succeeded", effectState: "known", finishedAtMs: 3,
    result: { version: 1, text: "synthetic", errorCode: null, lastSequence: 3 } };
  const valid = { kind: "committed", pid: 1, backendPid: 2, dto, result, fingerprint: "a".repeat(64), otherRunId: id, otherAttemptId: id, denials: 0 };
  expect(parseRestartMessage(JSON.stringify(valid)).kind).toBe("committed");
  for (const patch of [{ extra: true }, { denials: 6 }, { pid: 0 }, { fingerprint: "bad" }, { result: { ...result, runId: "00000000-0000-4000-8000-000000000002" } }])
    expect(() => parseRestartMessage(JSON.stringify({ ...valid, ...patch }))).toThrow("Restart message unavailable.");
});

for (const mode of ["backfill", "exhaustion"] as const) {
  test(`activation ${mode} forwards exactly one fixed selector and cleans both outcomes`, async () => {
    for (const exit of [0, 1]) {
      const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, [`identity-activation-${mode}`]);
      expect(result.exit).toBe(exit);
      expect(result.calls.split("\n").filter(line => line.endsWith("proof"))).toEqual(["activation-proof"]);
      expect(result.calls.split("\n").filter(line => line.startsWith("proof-argv"))).toEqual([
        `proof-argv <--no-env-file> <./apps/server/src/modules/identity/identity-activation.integration.ts> <${mode}>`,
      ]);
      expect(result.calls).toContain("down --timeout 5");
      expect(result.stdout).toContain("PASS dedicated Compose container/network cleanup");
      expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
    }
  });
  test(`activation ${mode} denies existing resources unsafe environment and extra arguments`, async () => {
    for (const overrides of [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }]) {
      const result = await runFixture(overrides, [`identity-activation-${mode}`]);
      expect(result.exit).toBe(1);
      expect(result.calls).not.toMatch(/ up |down --timeout|proof-argv|activation-proof/);
    }
    const extra = await runFixture({}, [`identity-activation-${mode}`, "extra"]);
    expect(extra.exit).toBe(1); expect(extra.calls).toBe("");
  });
}
test("activation unknown selector denies before Docker and old modes keep empty proof arguments", async () => {
  const unknown = await runFixture({}, ["identity-activation-arbitrary"]);
  expect(unknown.exit).toBe(1); expect(unknown.calls).toBe("");
  for (const mode of ["auth", "operator", "credentials", "credential-operator", "identity-lock-order", "identity-lock-positive", "connection-schema", "connection-store", "run-schema", "run-store", "run-restart", "dispatch-schema", "browser"]) {
    const result = await runFixture({}, [mode]);
    expect(result.exit).toBe(0);
    const argv = result.calls.split("\n").filter(line => line.startsWith("proof-argv"));
    expect(argv.length).toBe(1);
    expect(argv[0]).toMatch(/^proof-argv <--no-env-file> <\.\/[^>]+>$/);
  }
});

test("run provenance diagnostic forwards exactly its fixed entry with empty arguments and preserves both cleanup outcomes", async () => {
  for (const exit of [0, 1]) {
    const result = await runFixture({ MOCK_PROOF_EXIT: String(exit) }, ["run-provenance-diagnostic"]);
    expect(result.exit).toBe(exit);
    expect(result.calls.split("\n").filter(line => line.startsWith("proof-argv"))).toEqual([
      "proof-argv <--no-env-file> <./apps/server/src/modules/runtime/run-provenance-diagnostic.integration.ts>",
    ]);
    expect(result.calls.split("\n").filter(line => line.endsWith("proof"))).toEqual(["run-provenance-diagnostic-proof"]);
    expect(result.calls.match(/down --timeout 5/g)).toHaveLength(1);
    expect(result.stdout).toContain("PASS dedicated Compose container/network cleanup");
    expect(result.stdout + result.stderr + result.calls).not.toContain("a".repeat(64));
  }
});
test("run provenance diagnostic denies foreign resources unsafe environment and arbitrary selectors before provisioning", async () => {
  for (const overrides of [{ MOCK_EXISTING: "container" }, { MOCK_EXISTING: "network" }, { MOCK_EXISTING: "volume" }, { MOCK_GUARD_EXIT: "1" }]) {
    const result = await runFixture(overrides, ["run-provenance-diagnostic"]);
    expect(result.exit).toBe(1);
    expect(result.calls).not.toMatch(/ up |down --timeout|proof-argv|run-provenance-diagnostic-proof/);
  }
  for (const args of [["run-provenance-diagnostic", "extra"], ["run-provenance-diagnostic-arbitrary"]]) {
    const result = await runFixture({}, args);
    expect(result.exit).toBe(1); expect(result.calls).toBe("");
  }
});
