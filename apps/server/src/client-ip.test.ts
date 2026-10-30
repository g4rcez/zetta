import { describe, expect, test } from "bun:test";
import { clientIp, stampClientIp } from "./client-ip";

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/auth/sign-in/email", { headers });

describe("clientIp", () => {
  test("uses the socket address when no proxy header is trusted", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6" }), "203.0.113.7", undefined)).toBe(
      "203.0.113.7",
    );
  });
  test("uses the last entry of the trusted header, not the part the client wrote", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }), "10.0.0.2", "X-Forwarded-For"),
    ).toBe("198.51.100.4");
  });
  test("falls back to the socket when the trusted header is missing", () => {
    expect(clientIp(req(), "203.0.113.7", "cf-connecting-ip")).toBe("203.0.113.7");
  });
  test("stamping replaces a client-supplied value in the header the rate limiter reads", () => {
    const r = req({ "x-zetta-client-ip": "6.6.6.6" });
    stampClientIp(r, "203.0.113.7");
    expect(r.headers.get("x-zetta-client-ip")).toBe("203.0.113.7");
  });
});
