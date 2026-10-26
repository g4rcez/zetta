import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { boundary, cases, caseSchema, parseRow } from "../../../../../scripts/fixtures/journal-crash-contract";

const fixtures = fileURLToPath(new URL("../../../../../scripts/fixtures/", import.meta.url));
test("closed selectors distinguish insertion-only allocation cuts", () => {
  expect(cases.length).toBe(17);
  expect(new Set(cases).size).toBe(17);
  for (const bad of ["C1-replace", "C2-replace", "../journal", "C9-effect", "C0-insert ", null]) expect(caseSchema.safeParse(bad).success).toBe(false);
  expect(boundary("C0-insert")).toBe("before_mkdir");
  expect(boundary("C0-replace")).toBe("before_stage");
  expect(boundary("C4-sync-insert")).toBe("after_file_sync");
  expect(boundary("C4-sync-replace")).toBe("after_file_sync");
  expect(boundary("C4-insert")).toBe("after_close");
  expect(boundary("C4-replace")).toBe("after_close");
  expect(boundary("C8-effect")).toBe("synthetic_effect");
});
test("protocol rejects extra authority, unsafe counts, noncanonical and duplicate fields", () => {
  const valid = { type: "cut", case: "C3-insert", pid: 42, boundary: "partial_write", captured: true, atMs: 123 } as const;
  expect(parseRow(JSON.stringify(valid))).toEqual(valid);
  for (const raw of [{ ...valid, exec: "sh" }, { ...valid, captured: false }, { ...valid, pid: -1 }, { ...valid, type: "unknown" },
    { type: "effect", case: "C8-effect", pid: 42, synthetic: true, count: 2 }]) expect(() => parseRow(JSON.stringify(raw))).toThrow();
  expect(() => parseRow('{"type":"ready","case":"C0-insert","pid":42,"pid":42}')).toThrow();
  expect(() => parseRow(JSON.stringify(valid) + " ")).toThrow();
  expect(() => parseRow("x".repeat(4097))).toThrow();
  const entry = { name: ".writer.lock", size: 0, sha256: "0".repeat(64) };
  for (const entries of [[{ ...entry, name: "../record" }], [entry, entry]]) {
    expect(() => parseRow(JSON.stringify({ type: "recovered", case: "C1-insert", pid: 42, disposition: "blocked", receiptId: null, submissionPaths: false, initialEntries: entries, finalEntries: [] }))).toThrow();
  }
});
test("recovery protocol distinguishes initial survival from final persisted bytes", () => {
  const initial = { name: "record.json", size: 123, sha256: "0".repeat(64) };
  const final = { ...initial, size: 150, sha256: "1".repeat(64) };
  const raw = { type: "recovered", case: "C8-effect", pid: 42, disposition: "unknown",
    receiptId: "11111111-1111-4111-8111-111111111111", submissionPaths: false, initialEntries: [initial], finalEntries: [final] };
  const parsed = parseRow(JSON.stringify(raw));
  if (parsed.type !== "recovered") throw new Error("wrong row");
  expect(parsed.initialEntries[0]?.sha256).toBe(initial.sha256);
  expect(parsed.finalEntries[0]?.sha256).toBe(final.sha256);
  expect(() => parseRow(JSON.stringify({ ...raw, finalEntries: undefined }))).toThrow();
  expect(() => parseRow(JSON.stringify({ ...raw, entries: [initial] }))).toThrow();
  expect(() => parseRow(JSON.stringify({ ...raw, finalEntries: [final, final] }))).toThrow();
});
test("all imports are inert and actual unsupported-host entry points fail before target I/O", () => {
  if (process.platform === "linux") throw new Error("requires separately reviewed Linux proof");
  for (const file of ["journal-crash-contract.ts", "journal-writer-child.ts", "journal-recovery-child.ts", "journal-crash-proof.ts"]) {
    const imported = spawnSync(process.execPath, ["--no-env-file", "-e", `await import(${JSON.stringify(fixtures + file)})`], { encoding: "utf8", timeout: 3000 });
    expect(imported.status).toBe(0); expect(imported.signal ?? null).toBeNull(); expect(imported.stdout).toBe(""); expect(imported.stderr).toBe("");
    if (file === "journal-crash-contract.ts") continue;
    const run = spawnSync(process.execPath, ["--no-env-file", fixtures + file, "../bad"], { encoding: "utf8", timeout: 3000 });
    expect(run.status).toBe(1); expect(run.signal ?? null).toBeNull();
    expect(run.stdout).toBe(file === "journal-crash-proof.ts" ? '{"type":"unproved","retained":true}\n' : "");
    expect(run.stderr).toBe(file === "journal-writer-child.ts" ? "writer_unproved\n" : file === "journal-recovery-child.ts" ? "recovery_unproved\n" : "");
  }
});
