import { describe, expect, test } from "bun:test";
import {
  allowLocalModelServer,
  checkModelAddress,
  compatibleKey,
  COMPATIBLE_NO_KEY,
  classifyIp,
  parseCompatibleConfig,
  resolvedAddressIssue,
} from "./model-server";

const local = { allowLocal: true };
const remote = { allowLocal: false };

describe("classifyIp", () => {
  test.each([
    ["127.0.0.1", "loopback"],
    ["127.9.9.9", "loopback"],
    ["::1", "loopback"],
    ["[::1]", "loopback"],
    ["10.0.0.5", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.20", "private"],
    ["100.64.0.1", "private"],
    ["fd12:3456::1", "private"],
    ["8.8.8.8", "public"],
    ["172.15.0.1", "public"],
    ["172.32.0.1", "public"],
    ["2606:4700:4700::1111", "public"],
    ["169.254.169.254", "blocked"],
    ["169.254.0.1", "blocked"],
    ["100.100.100.200", "blocked"],
    ["0.0.0.0", "blocked"],
    ["224.0.0.1", "blocked"],
    ["255.255.255.255", "blocked"],
    ["::", "blocked"],
    ["fe80::1", "blocked"],
    ["fd00:ec2::254", "blocked"],
    ["ff02::1", "blocked"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:a9fe:a9fe", "blocked"],
    ["::ffff:169.254.169.254", "blocked"],
    ["::ffff:8.8.8.8", "public"],
    ["64:ff9b::a9fe:a9fe", "blocked"],
    ["2002:a9fe:a9fe::1", "blocked"],
    ["not an ip", "blocked"],
    ["999.1.1.1", "blocked"],
  ])("%s is %s", (ip, expected) => {
    expect(classifyIp(ip)).toBe(expected as never);
  });
});

describe("checkModelAddress", () => {
  test("a model on this machine is allowed for the owner of the server, http included", () => {
    expect(checkModelAddress("http://127.0.0.1:11434/v1", local)).toEqual({
      ok: true,
      baseUrl: "http://127.0.0.1:11434/v1",
      hostKind: "loopback",
    });
    expect(checkModelAddress("http://localhost:11434", local)).toMatchObject({
      ok: true,
      hostKind: "loopback",
    });
    expect(checkModelAddress("http://[::1]:8000/v1/", local)).toMatchObject({
      ok: true,
      baseUrl: "http://[::1]:8000/v1",
    });
  });
  test("the local network is allowed for the owner: LAN address, one-word name, .local name, Tailscale range", () => {
    for (const u of [
      "http://192.168.1.20:11434/v1",
      "http://10.1.2.3:8080",
      "http://ollama:11434/v1",
      "http://gpu-box.local:1234/v1",
      "http://100.101.102.103:11434",
    ])
      expect(checkModelAddress(u, local)).toMatchObject({ ok: true, hostKind: "private" });
  });
  test("the same addresses are refused for someone who is not the owner", () => {
    for (const u of [
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      "http://192.168.1.20",
      "http://ollama:11434",
      "https://gpu-box.local",
    ])
      expect(checkModelAddress(u, remote)).toEqual({ ok: false, issue: "local_not_allowed" });
  });
  test("cloud metadata is refused for everyone", () => {
    for (const u of [
      "http://169.254.169.254/latest/meta-data",
      "https://169.254.169.254",
      "http://[fd00:ec2::254]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://metadata.google.internal/computeMetadata/v1",
      "http://metadata/",
      "http://100.100.100.200/",
      "http://0.0.0.0:11434",
      "http://[fe80::1]/",
      // Other spellings of the same addresses: the URL parser turns them into the dotted form.
      "http://2852039166/",
      "http://0xa9.0xfe.0xa9.0xfe/",
      "http://0251.0376.0251.0376/",
    ])
      for (const o of [local, remote])
        expect(checkModelAddress(u, o)).toEqual({ ok: false, issue: "blocked_address" });
  });
  test("other spellings of loopback are still loopback, so they need the owner", () => {
    for (const u of [
      "http://2130706433/",
      "http://0x7f.1/",
      "http://127.1/",
      "http://0177.0.0.1/",
    ]) {
      expect(checkModelAddress(u, local)).toMatchObject({ ok: true, hostKind: "loopback" });
      expect(checkModelAddress(u, remote)).toEqual({ ok: false, issue: "local_not_allowed" });
    }
  });
  test("only http and https", () => {
    for (const u of [
      "file:///etc/passwd",
      "ftp://example.com",
      "gopher://127.0.0.1",
      "ws://example.com",
    ])
      expect(checkModelAddress(u, local)).toEqual({ ok: false, issue: "scheme" });
  });
  test("a public host needs https; its name is left for the caller to resolve", () => {
    expect(checkModelAddress("http://models.example.com/v1", remote)).toEqual({
      ok: false,
      issue: "insecure_public",
    });
    expect(checkModelAddress("http://8.8.8.8/v1", local)).toEqual({
      ok: false,
      issue: "insecure_public",
    });
    expect(checkModelAddress("https://models.example.com/v1/", remote)).toEqual({
      ok: true,
      baseUrl: "https://models.example.com/v1",
      hostKind: "name",
    });
    expect(checkModelAddress("https://8.8.8.8", remote)).toMatchObject({
      ok: true,
      hostKind: "public",
    });
  });
  test("no user name, password, query or fragment, and not too long", () => {
    expect(checkModelAddress("http://user:pw@127.0.0.1", local)).toEqual({
      ok: false,
      issue: "credentials",
    });
    expect(checkModelAddress("http://token@127.0.0.1", local)).toEqual({
      ok: false,
      issue: "credentials",
    });
    expect(checkModelAddress("http://127.0.0.1/v1?key=1", local)).toEqual({
      ok: false,
      issue: "query_or_fragment",
    });
    expect(checkModelAddress("http://127.0.0.1/v1#x", local)).toEqual({
      ok: false,
      issue: "query_or_fragment",
    });
    expect(checkModelAddress("http://127.0.0.1/v1?", local)).toEqual({
      ok: false,
      issue: "query_or_fragment",
    });
    expect(checkModelAddress(`https://example.com/${"a".repeat(600)}`, remote)).toEqual({
      ok: false,
      issue: "too_long",
    });
    expect(checkModelAddress("nonsense", local)).toEqual({ ok: false, issue: "not_a_url" });
    expect(checkModelAddress("", local)).toEqual({ ok: false, issue: "not_a_url" });
  });
});

describe("resolvedAddressIssue", () => {
  test("a name that resolves to a blocked address is refused, whatever else it resolves to", () => {
    expect(resolvedAddressIssue(["8.8.8.8", "169.254.169.254"], local)).toBe("blocked_address");
  });
  test("a name that resolves to the local network needs the owner", () => {
    expect(resolvedAddressIssue(["192.168.1.9"], remote)).toBe("local_not_allowed");
    expect(resolvedAddressIssue(["8.8.8.8", "127.0.0.1"], remote)).toBe("local_not_allowed");
    expect(resolvedAddressIssue(["192.168.1.9"], local)).toBeNull();
  });
  test("a public answer is fine and an empty one is not", () => {
    expect(resolvedAddressIssue(["8.8.8.8", "2606:4700:4700::1111"], remote)).toBeNull();
    expect(resolvedAddressIssue([], local)).toBe("unresolvable");
  });
});

describe("parseCompatibleConfig", () => {
  test("a good config is normalized", () => {
    expect(
      parseCompatibleConfig(
        { baseUrl: " http://127.0.0.1:11434/v1/ ", model: " llama3.1:8b " },
        local,
      ),
    ).toEqual({
      ok: true,
      config: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1:8b" },
      hostKind: "loopback",
    });
    expect(
      parseCompatibleConfig(
        { baseUrl: "http://ollama:11434", model: "hf.co/org/model:Q4_K_M" },
        local,
      ),
    ).toMatchObject({ ok: true });
  });
  test("the address error names the field", () => {
    expect(parseCompatibleConfig({ baseUrl: "http://127.0.0.1", model: "m" }, remote)).toEqual({
      ok: false,
      error: { field: "baseUrl", issue: "local_not_allowed" },
    });
  });
  test("the model name is checked", () => {
    for (const model of ["", "  ", "a b", "x;rm", "-flag", "m".repeat(101), "../x"])
      expect(parseCompatibleConfig({ baseUrl: "http://127.0.0.1", model }, local)).toEqual({
        ok: false,
        error: { field: "model", issue: "model_invalid" },
      });
  });
  test("anything that is not an object with two strings is refused", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      1,
      [],
      {},
      { baseUrl: 1, model: "m" },
      { baseUrl: "http://127.0.0.1" },
    ])
      expect(parseCompatibleConfig(bad, local)).toEqual({
        ok: false,
        error: { field: "config", issue: "config_invalid" },
      });
  });
});

describe("allowLocalModelServer", () => {
  test("the owner, or an operator who opened it for everyone", () => {
    expect(allowLocalModelServer({ isAdmin: true, operatorAllowsPrivate: false })).toBe(true);
    expect(allowLocalModelServer({ isAdmin: false, operatorAllowsPrivate: true })).toBe(true);
    expect(allowLocalModelServer({ isAdmin: false, operatorAllowsPrivate: false })).toBe(false);
  });
});

describe("compatibleKey", () => {
  test("the placeholder means no credential; a real key passes through", () => {
    expect(compatibleKey(COMPATIBLE_NO_KEY)).toBeNull();
    expect(compatibleKey("")).toBeNull();
    expect(compatibleKey("sk-test-0123456789")).toBe("sk-test-0123456789");
  });
});
