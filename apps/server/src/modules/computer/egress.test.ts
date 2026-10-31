import { afterAll, describe, expect, test } from "bun:test";
import { connect, createServer } from "node:net";
import { createEgressProxy } from "./egress";
import { isBlockedIp } from "./service";

// The upstream echoes whatever it receives, so a test sees exactly what the proxy forwarded.
const upstream = createServer((s) => s.on("data", (d) => s.write(d)));
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
const upstreamPort = (upstream.address() as { port: number }).port;

const dialed: string[] = [];
const looked: string[] = [];
const names: Record<string, string[]> = {
  "example.com": ["93.184.216.34"],
  "rebind.example": ["127.0.0.1"],
  "mixed.example": ["93.184.216.34", "10.0.0.1"],
};
const proxy = createEgressProxy({
  isBlockedIp,
  lookup: async (h) => {
    looked.push(h);
    return names[h] ?? [];
  },
  dial: (ip, port) => {
    dialed.push(`${ip}:${port}`);
    return connect({ host: "127.0.0.1", port: upstreamPort });
  },
});
const port = await proxy.listenTcp();
afterAll(() => {
  proxy.close();
  upstream.close();
});

/** Sends raw bytes to the proxy, then `later` once the proxy has answered, and returns everything it sent back. */
function ask(raw: string, later?: string): Promise<string> {
  return new Promise((resolve) => {
    const c = connect({ host: "127.0.0.1", port });
    let out = "";
    c.on("data", (d) => {
      out += d.toString("latin1");
      if (later && out.includes("200 Connection Established")) {
        c.write(later);
        later = undefined;
      }
    });
    c.on("close", () => resolve(out));
    c.write(raw);
    setTimeout(() => c.destroy(), 400);
  });
}

describe("egress proxy", () => {
  test("refuses local, private and rebinding targets and never dials them", async () => {
    dialed.length = 0;
    for (const target of [
      "localhost:443",
      "app.localhost:443",
      "db.internal:5432",
      "10.0.0.5:80",
      "[::1]:80",
      "169.254.169.254:80",
      "rebind.example:443",
      "mixed.example:443",
      "unknown.example:443",
    ])
      expect(await ask(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)).toStartWith(
        "HTTP/1.1 403 Forbidden",
      );
    expect(dialed).toEqual([]);
  });

  test("a public CONNECT target is resolved once, dialed by the checked address, and bytes flow both ways", async () => {
    dialed.length = 0;
    looked.length = 0;
    const out = await ask(
      "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
      "ping",
    );
    expect(out).toBe("HTTP/1.1 200 Connection Established\r\n\r\nping");
    expect(dialed).toEqual(["93.184.216.34:443"]);
    expect(looked).toEqual(["example.com"]);
  });

  test("plain http is forwarded in origin form on a connection that closes", async () => {
    dialed.length = 0;
    const out = await ask(
      "GET http://example.com/a?b=1 HTTP/1.1\r\nHost: example.com\r\nProxy-Connection: keep-alive\r\nAccept: */*\r\n\r\n",
    );
    expect(out).toBe(
      "GET /a?b=1 HTTP/1.1\r\nHost: example.com\r\nAccept: */*\r\nConnection: close\r\n\r\n",
    );
    expect(dialed).toEqual(["93.184.216.34:80"]);
  });

  test("other schemes, private hosts and malformed requests are refused", async () => {
    dialed.length = 0;
    expect(await ask("GET ftp://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n")).toStartWith(
      "HTTP/1.1 403 Forbidden",
    );
    expect(await ask("GET http://127.0.0.1:8080/ HTTP/1.1\r\nHost: x\r\n\r\n")).toStartWith(
      "HTTP/1.1 403 Forbidden",
    );
    expect(await ask("GET /relative HTTP/1.1\r\nHost: x\r\n\r\n")).toStartWith(
      "HTTP/1.1 400 Bad Request",
    );
    expect(await ask("CONNECT example.com:99999 HTTP/1.1\r\n\r\n")).toStartWith(
      "HTTP/1.1 400 Bad Request",
    );
    expect(await ask("not http\r\n\r\n")).toStartWith("HTTP/1.1 400 Bad Request");
    expect(dialed).toEqual([]);
  });

  test("an oversized request head is refused", async () => {
    expect(await ask(`GET http://example.com/ HTTP/1.1\r\nX: ${"a".repeat(20_000)}`)).toStartWith(
      "HTTP/1.1 431 Request Header Fields Too Large",
    );
  });
});
