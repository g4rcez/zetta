import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSerializer } from "./computer/serial";
import { assertWebScheme, ComputerError, isBlockedIp } from "./computer/service";
import { createFileStore, FileAccessError } from "./chat/files";
import { createDecisionService, DecisionError } from "./decisions/service";
import { applyRedaction, matches, safeRegex } from "./features/safety";
import { parseAllowlist } from "./integrations/mcp";

describe("ReDoS: catastrophic patterns never run", () => {
  test.each(["(a+)+$", "(a*)*b", "(a|aa)+$", "(.*)*x", "^(([a-z])+.)+[A-Z]([a-z])+$", "(x+x+)+y"])("rejects or bounds %s", async (pattern) => {
    const started = Date.now();
    const text = "a".repeat(40) + "!";
    if (safeRegex(pattern)) await matches(text, pattern); // allowed patterns still run under a hard timeout in a worker
    else expect(safeRegex(pattern)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });
  test("a harmless pattern still redacts", async () => { expect((await applyRedaction("call 555-1234 now", "\\d{3}-\\d{4}", "[x]")).text).toBe("call [x] now"); });
});

describe("SSRF: private, loopback, link-local and mapped IPv6 forms are blocked", () => {
  test.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1"])("blocks %s", (ip) => { expect(isBlockedIp(ip)).toBe(true); });
  test.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public %s", (ip) => { expect(isBlockedIp(ip)).toBe(false); });
  test.each(["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "data:text/html,x", "gopher://x"])("only http(s): %s", (u) => { expect(() => assertWebScheme(u)).toThrow(ComputerError); });
});

describe("MCP stdio allowlist parsing", () => {
  test("entries are command + exact argv, separated by semicolons; empty input allows nothing", () => {
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist("npx -y chrome-devtools-mcp@latest; node server.js --flag")).toEqual([{ command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] }, { command: "node", args: ["server.js", "--flag"] }]);
  });
});

describe("start serialization", () => {
  test("jobs for one key never interleave; different keys do", async () => {
    const serial = createSerializer(); const log: string[] = [];
    const job = (name: string, ms: number) => async () => { log.push(`${name}:start`); await Bun.sleep(ms); log.push(`${name}:end`); return name; };
    const [a, b, c] = await Promise.all([serial("u1", job("a", 30)), serial("u1", job("b", 5)), serial("u2", job("c", 5))]);
    expect([a, b, c]).toEqual(["a", "b", "c"]);
    expect(log.indexOf("a:end")).toBeLessThan(log.indexOf("b:start")); // same user: strictly sequential
    expect(log.indexOf("c:start")).toBeLessThan(log.indexOf("a:end")); // other user: not blocked
  });
  test("a failing job does not block the next one", async () => {
    const serial = createSerializer();
    await expect(serial("k", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(await serial("k", async () => "ok")).toBe("ok");
  });
});

describe("decision backlog is bounded", () => {
  test("a flood from one owner or overall fails fast with 'unavailable', others still served", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const model = { systemOne: async () => { await gate; return { model: "laya", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }; }, close: async () => {} };
    const svc = createDecisionService(async () => model as never, 5000, { queue: 6, perOwner: 2 });
    const q = { pick: { type: "choice", instructions: "x", criteria: { a: "a" } } } as never;
    const mine = [svc.decide("s", q, "u1"), svc.decide("s", q, "u1")];
    await expect(svc.decide("s", q, "u1")).rejects.toBeInstanceOf(DecisionError); // per-owner cap
    const other = svc.decide("s", q, "u2"); // another owner is still accepted
    release(); await Promise.all([...mine, other]);
    await expect(Promise.all(Array.from({ length: 8 }, (_, i) => svc.decide("s", q, `o${i}`)))).rejects.toBeInstanceOf(DecisionError); // global cap (6)
  });
});

describe("authorized files", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zfiles-"));
    await mkdir(join(root, "shared"), { recursive: true }); await mkdir(join(root, "me", "u1"), { recursive: true }); await mkdir(join(root, "me", "u2"), { recursive: true });
    await writeFile(join(root, "shared", "ok.txt"), "hello"); await writeFile(join(root, "shared", ".env"), "SECRET=1"); await writeFile(join(root, "shared", "credentials.json"), "{}");
    await writeFile(join(root, "me", "u2", "private.txt"), "u2 only");
    await symlink(join(root, "me", "u2", "private.txt"), join(root, "shared", "link.txt")); // symlink out of the area
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const fs = () => createFileStore(root);
  test("reads allowed files", async () => { expect(await fs().read("u1", "shared/ok.txt")).toBe("hello"); });
  test.each(["shared/.env", "shared/credentials.json", "shared/../me/u2/private.txt", "me/u2/private.txt", "shared/link.txt", "shared\\ok.txt", "shared/ok.txt\u0000.png"])("refuses %j", async (p) => {
    await expect(fs().read("u1", p)).rejects.toBeInstanceOf(FileAccessError);
  });
  test("listings never show denied names", async () => { expect((await fs().list("u1", "shared")).map((e) => e.name)).not.toContain(".env"); });
});
