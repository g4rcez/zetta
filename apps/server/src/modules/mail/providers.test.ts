import { describe, expect, test } from "bun:test";
import { detectMailServers, PROVIDER_TABLE, type DnsResolver } from "./providers";

const fake = (
  srv: Record<string, { name: string; port: number; priority: number; weight: number }[]> = {},
  mx: Record<string, string[]> = {},
) => {
  const asked: string[] = [];
  const r: DnsResolver = {
    srv: async (n) => (asked.push(n), srv[n] ?? []),
    mx: async (n) => (
      asked.push(n),
      (mx[n] ?? []).map((exchange, i) => ({ exchange, priority: i }))
    ),
  };
  return { r, asked };
};

describe("detectMailServers", () => {
  test("a table hit answers without DNS", async () => {
    const { r, asked } = fake();
    const d = await detectMailServers("Ana@iCloud.com", r);
    expect(d.status).toBe("known");
    expect(d.imap).toEqual({ host: "imap.mail.me.com", port: 993, security: "tls" });
    expect(d.smtp).toEqual({ host: "smtp.mail.me.com", port: 587, security: "starttls" });
    expect(d.user).toBe("Ana@iCloud.com");
    expect(d.appPasswordUrl).toStartWith("https://");
    expect(asked).toEqual([]);
  });
  test("every table entry has valid servers", () => {
    for (const e of PROVIDER_TABLE) {
      expect(e.imap.host).toMatch(/^[a-z0-9.-]+$/);
      expect(e.docsUrl).toStartWith("https://");
      expect(e.domains.length).toBeGreaterThan(0);
    }
  });
  test("SRV records give the servers, best priority first, 465 is tls", async () => {
    const { r } = fake({
      "_imaps._tcp.corp.example.invalid": [
        { name: "imap2.corp.example.invalid.", port: 993, priority: 20, weight: 1 },
        { name: "imap.corp.example.invalid.", port: 993, priority: 10, weight: 1 },
      ],
      "_submission._tcp.corp.example.invalid": [
        { name: "smtp.corp.example.invalid", port: 587, priority: 0, weight: 0 },
      ],
    });
    const d = await detectMailServers("a@corp.example.invalid", r);
    expect(d.status).toBe("dns");
    expect(d.imap).toEqual({ host: "imap.corp.example.invalid", port: 993, security: "tls" });
    expect(d.smtp).toEqual({ host: "smtp.corp.example.invalid", port: 587, security: "starttls" });
  });
  test("an SRV target of '.' or a bad host name is ignored", async () => {
    const { r } = fake({
      "_imaps._tcp.x.example.invalid": [
        { name: ".", port: 0, priority: 0, weight: 0 },
        { name: "bad host", port: 993, priority: 0, weight: 0 },
      ],
    });
    expect((await detectMailServers("a@x.example.invalid", r)).status).toBe("unknown");
  });
  test("a Google-hosted domain (by MX) says to use the Google connection", async () => {
    const { r } = fake(
      {},
      { "acme.example.invalid": ["aspmx.l.google.com", "alt1.aspmx.l.google.com"] },
    );
    const d = await detectMailServers("a@acme.example.invalid", r);
    expect(d.status).toBe("google");
    expect(d.message).toContain("Google connection");
    expect(d.imap?.host).toBe("imap.gmail.com");
    expect((await detectMailServers("a@googlemail.com", r)).status).toBe("google");
  });
  test("a Microsoft-hosted domain is the Microsoft plugin's, by MX and by name", async () => {
    const { r } = fake(
      {},
      { "acme.example.invalid": ["acme-example-invalid.mail.protection.outlook.com"] },
    );
    const d = await detectMailServers("a@acme.example.invalid", r);
    expect(d.status).toBe("microsoft");
    expect(d.message).toContain("Microsoft plugin");
    expect(d.imap).toBeUndefined();
    for (const h of ["outlook.com", "hotmail.com", "live.com"])
      expect((await detectMailServers(`a@${h}`, r)).status).toBe("microsoft");
  });
  test("a domain hosted by Fastmail by MX is recognised", async () => {
    const { r } = fake({}, { "acme.example.invalid": ["in1-smtp.messagingengine.com"] });
    expect((await detectMailServers("a@acme.example.invalid", r)).provider?.id).toBe("fastmail");
  });
  test("a domain with nothing is unknown, and a resolver that fails is the same", async () => {
    expect((await detectMailServers("a@none.example.invalid", fake().r)).status).toBe("unknown");
    const broken: DnsResolver = {
      srv: async () => Promise.reject(new Error("x")),
      mx: async () => Promise.reject(new Error("x")),
    };
    expect((await detectMailServers("a@none.example.invalid", broken)).status).toBe("unknown");
  });
  test("a malformed address is invalid and asks nothing", async () => {
    const { r, asked } = fake();
    for (const a of [
      "",
      "ana",
      "ana@",
      "@x.com",
      "a b@x.com",
      "a@x",
      "a@-x.com",
      "a@b@c.com",
      `${"a".repeat(400)}@x.com`,
    ]) {
      expect((await detectMailServers(a, r)).status).toBe("invalid");
    }
    expect(asked).toEqual([]);
  });
});
