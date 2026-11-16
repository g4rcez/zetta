import { describe, expect, test } from "bun:test";
import type { networkInterfaces } from "node:os";

import { localOrigins } from "./local-origins";

type Interfaces = ReturnType<typeof networkInterfaces>;
const entry = (address: string, family: "IPv4" | "IPv6") =>
  ({ address, family, internal: false, cidr: null, mac: "", netmask: "" }) as never;

describe("localOrigins", () => {
  const interfaces: Interfaces = {
    lo0: [entry("127.0.0.1", "IPv4"), entry("::1", "IPv6")],
    en0: [entry("192.168.31.232", "IPv4"), entry("fe80::1", "IPv6")],
    utun4: [entry("100.108.128.101", "IPv4"), entry("fd7a:115c:a1e0::1", "IPv6")],
  };

  test("trusts localhost and every interface address on the public scheme and port", () => {
    expect(localOrigins("https://example.invalid:3000", interfaces).sort()).toEqual(
      [
        "https://localhost:3000",
        "https://127.0.0.1:3000",
        "https://[::1]:3000",
        "https://192.168.31.232:3000",
        "https://100.108.128.101:3000",
        "https://[fd7a:115c:a1e0::1]:3000",
      ].sort(),
    );
  });

  test("skips link-local IPv6, which has no usable Origin", () => {
    expect(localOrigins("https://example.invalid:3000", interfaces)).not.toContain(
      "https://[fe80::1]:3000",
    );
  });

  test("follows the public URL's scheme, and omits a default port", () => {
    expect(localOrigins("http://example.invalid", { en0: [entry("10.0.0.5", "IPv4")] })).toEqual([
      "http://localhost",
      "http://10.0.0.5",
    ]);
  });

  test("works with no interfaces", () => {
    expect(localOrigins("https://example.invalid:3000", {})).toEqual(["https://localhost:3000"]);
  });
});
