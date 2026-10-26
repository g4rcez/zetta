import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOperatorInput, requireOperatorTarget, runAdminOperator, readOperatorInput } from "./admin-operator";
import type { OperatorDependencies } from "./admin-operator";

const env = { ZETTA_OPERATOR_DATABASE_URL: "postgresql://operator:synthetic@127.0.0.1:55432/identity_local", ZETTA_OPERATOR_ALLOW_MUTATION: "identity-admin" };
const encoder = new TextEncoder();
const input = (value: unknown) => JSON.stringify(value);
function fixture(options: { fail?: string; body?: string; tty?: boolean } = {}) {
  const calls: unknown[] = [];
  const stdout: string[] = [], stderr: string[] = [];
  let deadline: (() => void) | undefined;
  let closed = false;
  const fail = (phase: string) => { if (options.fail === phase) throw new Error("PRIVATE driver/input detail"); };
  const deps: OperatorDependencies = {
    isTTY: () => options.tty ?? false,
    readInput: async () => { calls.push("read"); fail("input"); return options.body ?? input({ userId: "selected" }); },
    startDeadline: (expired) => { calls.push("timer"); deadline = expired; return () => { calls.push("clear"); }; },
    terminate: () => { calls.push("terminate"); },
    open: async (target) => {
      calls.push(["open", target]); fail("connection");
      return {
        service: {
          bootstrapExistingAccount: async (value) => { calls.push(["bootstrap", value]); fail("operation"); fail("commit"); return { adminUserId: "PRIVATE" }; },
          replaceAdminWithExistingAccount: async (value) => { calls.push(["replace", value]); fail("operation"); fail("commit"); return { previousAdminUserId: "PRIVATE", adminUserId: "PRIVATE" }; },
        },
        healthy: () => { calls.push("healthy"); fail(closed ? "post-close" : "healthy"); },
        close: async () => { calls.push("close"); closed = true; fail("cleanup"); },
      };
    },
    stdout: (text) => { stdout.push(text); }, stderr: (text) => { stderr.push(text); },
  };
  return { deps, calls, stdout, stderr, expire: () => deadline?.() };
}

test("operator target pins explicit effective fields, not app fallback or ambient pg defaults", () => {
  expect(requireOperatorTarget({ ...env, DATABASE_URL: "ignored deliberately" })).toEqual({ host: "127.0.0.1", port: 55432, database: "identity_local", user: "operator", password: "synthetic" });
  for (const host of ["localhost", "127.0.0.2", "[::1]"]) {
    expect(requireOperatorTarget({ ...env, ZETTA_OPERATOR_DATABASE_URL: `postgres://operator:synthetic@${host}/identity_local` })).toMatchObject({ host: host === "[::1]" ? "::1" : host, port: 5432 });
  }
  expect(requireOperatorTarget({ ...env, ZETTA_OPERATOR_DATABASE_URL: "postgres://operator:p%40ss%3Aword@localhost/my%20database" })).toMatchObject({ password: "p@ss:word", database: "my database", port: 5432 });
  for (const key of ["PGHOST", "pgport", "PGSERVICEFILE", "PGOPTIONS", "PGPASSWORD", "NODE_PG_FORCE_NATIVE"]) {
    expect(() => requireOperatorTarget({ ...env, [key]: "" })).toThrow("Admin operator unavailable (configuration).");
  }
  for (const patch of [{ ZETTA_OPERATOR_DATABASE_URL: undefined }, { ZETTA_OPERATOR_ALLOW_MUTATION: "true" }, { ZETTA_OPERATOR_ALLOW_MUTATION: undefined }]) {
    expect(() => requireOperatorTarget({ ...env, ...patch })).toThrow();
  }
});

test("operator target rejects unsafe or normalized URL forms without retaining input", () => {
  const unsafe = [
    "postgres://operator:secret@remote/identity_local", "postgres://operator:secret@127.1/db", "postgres://operator:secret@0177.0.0.1/db",
    "postgres://operator:secret@localhost./db", "postgres://operator:secret@LOCALHOST/db", "postgres://operator:secret@[0:0:0:0:0:0:0:1]/db",
    "postgres://operator:secret@localhost,127.0.0.1/db", "postgres://operator:secret@localhost:0/db", "postgres://operator:secret@localhost:65536/db",
    "postgres://operator:secret@localhost:05432/db", "postgres://operator:secret@localhost/db?sslmode=disable", "postgres://operator:secret@localhost/db#x",
    "postgres://operator:secret@localhost/", "postgres://operator:secret@localhost/db/extra", "postgres://operator:secret@localhost/..",
    "postgres://operator:secret@localhost/%2e%2e", "postgres://operator:secret@localhost/%252f", "postgres://operator:secret@localhost/db%2Fx",
    "postgres://operator:secret@localhost/db%00", "postgres://operator:secret@localhost/db\n", "postgres://operator:secret@localhost\\db",
    "postgres://operator@localhost/db", "postgres://:secret@localhost/db", "postgres://operator:@localhost/db", "postgres://operator:sec@ret@localhost/db",
    "postgres://operator:secret@localhost/%zz", "postgres://operator:secret@localhost/%64b", " postgresql://operator:secret@localhost/db",
  ];
  for (const url of unsafe) {
    try { requireOperatorTarget({ ...env, ZETTA_OPERATOR_DATABASE_URL: url }); throw new Error("expected denial"); }
    catch (error) { expect((error as Error).message).toBe("Admin operator unavailable (configuration)."); expect((error as Error).cause).toBeUndefined(); }
  }
});

test("operator JSON enforces exact action fields, safe reason codes and exact IDs", () => {
  expect(parseOperatorInput("bootstrap", input({ userId: "selected" }))).toEqual({ action: "bootstrap", input: { userId: "selected" } });
  for (const reason of ["admin-unavailable", "planned-transfer"] as const) {
    const value = { expectedAdminUserId: "old", newAdminUserId: "new", reason };
    expect(parseOperatorInput("replace", input(value))).toEqual({ action: "replace", input: value });
  }
  const invalid = [null, [], {}, { userId: "" }, { userId: " selected" }, { userId: "a\n" }, { userId: "a\u007f" }, { userId: "a\u0085" }, { userId: "ok", isOperator: true }, { userId: "ok", password: "private" }];
  for (const value of invalid) expect(() => parseOperatorInput("bootstrap", input(value))).toThrow();
  for (const patch of [{ reason: "private explanation" }, { reason: " planned-transfer" }, { reason: "" }, { newAdminUserId: "old" }, { newAdminUserId: " new" }, { operator: true }]) {
    expect(() => parseOperatorInput("replace", input({ expectedAdminUserId: "old", newAdminUserId: "new", reason: "planned-transfer", ...patch }))).toThrow();
  }
  const boundary = input({ userId: "a".repeat(4083) });
  expect(encoder.encode(boundary).byteLength).toBe(4096);
  expect(parseOperatorInput("bootstrap", boundary).action).toBe("bootstrap");
  for (const text of ["{", "null", input({ userId: "é".repeat(2048) }), boundary + " ", " ".repeat(4097)]) expect(() => parseOperatorInput("bootstrap", text)).toThrow();
});

test("bad args, target and TTY deny before stdin, timer or client; help stays offline", async () => {
  for (const args of [[], ["--help", "bootstrap"], ["bootstrap", "--operator"], ["replace", "--reason=planned-transfer"], ["unknown"]]) {
    const f = fixture(); expect(await runAdminOperator(args, env, f.deps)).toBe(1); expect(f.calls).toEqual([]); expect(f.stdout).toEqual([]); expect(f.stderr).toEqual(["Admin operator unavailable (configuration).\n"]);
  }
  for (const e of [{}, { DATABASE_URL: env.ZETTA_OPERATOR_DATABASE_URL }, { ...env, PGHOST: "localhost" }]) {
    const f = fixture(); expect(await runAdminOperator(["bootstrap"], e, f.deps)).toBe(1); expect(f.calls).toEqual([]);
  }
  const tty = fixture({ tty: true }); expect(await runAdminOperator(["bootstrap"], env, tty.deps)).toBe(1); expect(tty.calls).toEqual([]);
  const help = fixture(); expect(await runAdminOperator(["--help"], {}, help.deps)).toBe(0); expect(help.calls).toEqual([]); expect(help.stdout.join("")).toContain("bootstrap | replace"); expect(help.stderr).toEqual([]);
});

test("dispatch is exact and success follows service commit, health and close with no IDs", async () => {
  for (const action of ["bootstrap", "replace"] as const) {
    const value = action === "bootstrap" ? { userId: "selected" } : { expectedAdminUserId: "old", newAdminUserId: "new", reason: "planned-transfer" };
    const f = fixture({ body: input(value) });
    expect(await runAdminOperator([action], env, f.deps)).toBe(0);
    expect(f.calls).toEqual(["timer", "read", ["open", requireOperatorTarget(env)], [action, value], "healthy", "close", "healthy", "clear"]);
    expect(f.stdout).toEqual(["Admin operator completed.\n"]); expect(f.stderr).toEqual([]);
  }
});

test("input/open/service/commit/health/close failures remain opaque and clean up once", async () => {
  for (const fail of ["input", "connection", "operation", "commit", "healthy", "cleanup", "post-close"]) {
    const f = fixture({ fail }); expect(await runAdminOperator(["bootstrap"], env, f.deps)).toBe(1);
    expect(f.stdout).toEqual([]);
    const phase = fail === "commit" || fail === "healthy" ? "operation" : fail === "post-close" ? "cleanup" : fail;
    expect(f.stderr).toEqual([`Admin operator unavailable (${phase}).\n`]);
    expect(f.calls.filter((call) => call === "close")).toHaveLength(["input", "connection"].includes(fail) ? 0 : 1);
    expect(f.calls.at(-1)).toBe("clear");
  }
  const f = fixture({ body: input({ userId: "ok", isOperator: true }) });
  expect(await runAdminOperator(["bootstrap"], env, f.deps)).toBe(1); expect(f.calls).toEqual(["timer", "read", "clear"]);
});

test("bounded UTF-8 stream rejects overflow/malformed encoding and cancels on error or deadline", async () => {
  for (const chunks of [[encoder.encode(" ".repeat(4097))], [new Uint8Array([0xff])], [new Uint8Array([0xc3]), new Uint8Array([0x28])]]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); }, cancel() { cancelled = true; } });
    await expect(readOperatorInput(stream, new AbortController().signal)).rejects.toThrow(); expect(cancelled).toBe(true); expect(stream.locked).toBe(false);
  }
  const controller = new AbortController(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const pending = readOperatorInput(stream, controller.signal); controller.abort();
  await expect(pending).rejects.toThrow(); expect(cancelled).toBe(true);
  const good = new ReadableStream<Uint8Array>({ start(c) { const bytes = encoder.encode('"é"'); c.enqueue(bytes.slice(0, 2)); c.enqueue(bytes.slice(2)); c.close(); } });
  expect(await readOperatorInput(good, new AbortController().signal)).toBe('"é"');
  const boundary = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode("é".repeat(2048))); c.close(); } });
  expect(await readOperatorInput(boundary, new AbortController().signal)).toBe("é".repeat(2048));
  const truncated = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0xc3])); c.close(); } });
  await expect(readOperatorInput(truncated, new AbortController().signal)).rejects.toThrow(); expect(truncated.locked).toBe(false);
  const broken = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("PRIVATE stream error")); } });
  await expect(readOperatorInput(broken, new AbortController().signal)).rejects.toThrow("Admin operator unavailable (input)."); expect(broken.locked).toBe(false);
});

test("CLI and driver imports are inert; invalid executable startup never touches stdin/timers/network", async () => {
  const cli = new URL("./admin-operator-cli.ts", import.meta.url);
  const driver = new URL(import.meta.resolve("@zetta/db/admin-operator-client"));
  const guard = `
    import net from "node:net";
    import tls from "node:tls";
    const forbidden = () => { throw new Error("Forbidden operator startup IO"); };
    Object.defineProperty(process, "stdin", { get: forbidden });
    Bun.serve = forbidden; Bun.connect = forbidden;
    net.Socket.prototype.connect = forbidden; tls.connect = forbidden;
    globalThis.fetch = forbidden; globalThis.setTimeout = forbidden; globalThis.setInterval = forbidden;
  `;
  const folder = await mkdtemp(join(tmpdir(), "zetta-operator-offline-"));
  try {
    const preload = join(folder, "guard.ts"); await writeFile(preload, guard);
    async function child(args: string[], environment: Record<string, string> = {}) {
      const proc = Bun.spawn([process.execPath, "--no-env-file", "--preload", preload, ...args], { env: { NODE_ENV: "test", ...environment }, stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { exitCode, stdout, stderr };
    }
    expect(await child(["--eval", `await import(${JSON.stringify(cli.href)}); await import(${JSON.stringify(driver.href)});`])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    for (const args of [[], ["bootstrap"], ["replace", "--operator"]]) {
      expect(await child([fileURLToPath(cli), ...args], { DATABASE_URL: "postgres://operator:private@localhost/db" })).toEqual({ exitCode: 1, stdout: "", stderr: "Admin operator unavailable (configuration).\n" });
    }
    const help = await child([fileURLToPath(cli), "--help"]);
    expect(help.exitCode).toBe(0); expect(help.stdout).toContain("bootstrap | replace"); expect(help.stderr).toBe("");
    const source = await Bun.file(cli).text();
    expect(source).toContain("if (import.meta.main)");
    expect(source).toContain('await import("@zetta/db/admin-operator-client")');
    expect(source).toContain("20_000");
    expect(source).not.toMatch(/from ["']@zetta\/(?:db|auth)|(?:from|import) ["'][^"']*(?:dotenv|services)/);
    const pure = await Bun.file(new URL("./admin-operator.ts", import.meta.url)).text();
    expect(pure).toContain('import type { AdminOperatorTarget } from "@zetta/db/admin-operator-client"');
    expect(pure).toContain('import type { createAdminLifecycleService } from "./admin-lifecycle"');
    expect(pure).not.toMatch(/process\.env|Bun\.env|console\.|await import\(/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("deadline aborts input, emits only fixed failure and requests hard termination", async () => {
  const f = fixture();
  f.deps.readInput = async (signal) => { f.expire(); signal.throwIfAborted(); return ""; };
  expect(await runAdminOperator(["bootstrap"], env, f.deps)).toBe(1);
  expect(f.calls).toEqual(["timer", "terminate", "clear"]); expect(f.stdout).toEqual([]); expect(f.stderr).toEqual(["Admin operator unavailable (deadline).\n"]);
});
