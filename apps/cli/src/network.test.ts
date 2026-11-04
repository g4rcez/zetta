import { describe, expect, test } from "bun:test";
import { isHost, lanAddresses } from "./network";

const iface = (address: string, family: "IPv4" | "IPv6", internal = false) =>
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as never;

describe("lanAddresses", () => {
  test("keeps only private, non-loopback IPv4 addresses", () => {
    expect(
      lanAddresses({
        lo0: [iface("127.0.0.1", "IPv4", true)],
        en0: [
          iface("fe80::1", "IPv6"),
          iface("192.168.1.10", "IPv4"),
          iface("203.0.113.7", "IPv4"),
        ],
        en1: [iface("10.0.0.5", "IPv4"), iface("172.20.1.2", "IPv4"), iface("172.32.0.1", "IPv4")],
      }),
    ).toEqual(["192.168.1.10", "10.0.0.5", "172.20.1.2"]);
  });
});

describe("isHost", () => {
  test("accepts an IPv4 address and a host name", () => {
    expect(isHost("192.168.1.10")).toBe(true);
    expect(isHost("zetta.local")).toBe(true);
  });
  test("rejects anything that is not a host", () => {
    expect(isHost("1.2.3.4; rm -rf /")).toBe(false);
    expect(isHost("https://x.local")).toBe(false);
    expect(isHost("")).toBe(false);
  });
});
