import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect, createServer, isIP, type Server, type Socket } from "node:net";
import { rm } from "node:fs/promises";

export type EgressOptions = {
  /** True for any address that is not a plain public unicast address. */
  isBlockedIp: (ip: string) => boolean;
  /** Test seam: resolves a name to its addresses. */
  lookup?: (host: string) => Promise<string[]>;
  /** Test seam: opens the upstream connection to a checked address. */
  dial?: (ip: string, port: number) => Socket;
};

const MAX_HEAD = 16 * 1024;
const LOCAL_NAMES = [".localhost", ".local", ".internal"];

/**
 * A forward proxy that browsers go through, so the address policy applies to every request, redirect and sub-resource and not only to
 * the first navigation. Each host is resolved once; the connection goes to the address that passed the check, so a name that changes
 * its answer between the check and the connection (DNS rebinding) cannot reach a private address. Anything it cannot parse is refused.
 */
export function createEgressProxy(o: EgressOptions) {
  const lookup =
    o.lookup ?? (async (h: string) => (await dnsLookup(h, { all: true })).map((a) => a.address));
  const dial = o.dial ?? ((ip: string, port: number) => netConnect({ host: ip, port }));

  /** The address to connect to, or undefined when the target is not allowed. */
  async function allowed(rawHost: string): Promise<string | undefined> {
    const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || host === "localhost" || LOCAL_NAMES.some((s) => host.endsWith(s)))
      return undefined;
    const ips = isIP(host) ? [host] : await lookup(host).catch(() => [] as string[]);
    if (ips.length === 0 || ips.some(o.isBlockedIp)) return undefined;
    return ips[0];
  }

  const refuse = (c: Socket, status: string) =>
    c.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);

  function pipe(client: Socket, up: Socket) {
    const end = () => {
      client.destroy();
      up.destroy();
    };
    client.on("error", end);
    up.on("error", end);
    client.on("close", end);
    up.on("close", end);
    client.pipe(up);
    up.pipe(client);
  }

  async function handle(client: Socket, head: Buffer, rest: Buffer) {
    const [line = "", ...lines] = head.toString("latin1").split("\r\n");
    const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line);
    if (!m) return refuse(client, "400 Bad Request");
    const [, method, target] = m as unknown as [string, string, string];
    if (method === "CONNECT") {
      const t = /^(\[[0-9a-f:.]+\]|[^:\s[\]]+):(\d{1,5})$/i.exec(target);
      const port = t ? Number(t[2]) : 0;
      if (!t || port < 1 || port > 65535) return refuse(client, "400 Bad Request");
      const ip = await allowed(t[1]!);
      if (!ip) return refuse(client, "403 Forbidden");
      const up = dial(ip, port);
      up.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (rest.length) up.write(rest);
        pipe(client, up);
      });
      up.once("error", () => refuse(client, "502 Bad Gateway"));
      return;
    }
    // Plain http: the request target is an absolute URI. Forward it in origin form on one connection that closes after the reply.
    let u: URL;
    try {
      u = new URL(target);
    } catch {
      return refuse(client, "400 Bad Request");
    }
    if (u.protocol !== "http:") return refuse(client, "403 Forbidden");
    const ip = await allowed(u.hostname);
    if (!ip) return refuse(client, "403 Forbidden");
    const kept = lines.filter(
      (l) => !/^(proxy-connection|connection|keep-alive|proxy-authorization):/i.test(l),
    );
    const out = `${method} ${u.pathname}${u.search} HTTP/1.1\r\n${kept.join("\r\n")}\r\nConnection: close\r\n\r\n`;
    const up = dial(ip, Number(u.port || 80));
    up.once("connect", () => {
      up.write(Buffer.concat([Buffer.from(out, "latin1"), rest]));
      pipe(client, up);
    });
    up.once("error", () => refuse(client, "502 Bad Gateway"));
  }

  const onConnection = (client: Socket) => {
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) {
        if (buf.length > MAX_HEAD) {
          client.off("data", onData);
          refuse(client, "431 Request Header Fields Too Large");
        }
        return;
      }
      client.off("data", onData);
      client.pause();
      void handle(client, buf.subarray(0, end), buf.subarray(end + 4))
        .catch(() => refuse(client, "502 Bad Gateway"))
        .finally(() => client.resume());
    };
    client.on("data", onData);
    client.on("error", () => client.destroy());
  };
  const servers: Server[] = [];

  let tcp: Promise<number> | undefined;
  const unix = new Map<string, Promise<void>>();
  return {
    /** Loopback port for browsers that run on the host. */
    listenTcp(): Promise<number> {
      tcp ??= new Promise<number>((resolve, reject) => {
        const server = createServer(onConnection);
        servers.push(server);
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
      });
      return tcp;
    },
    /** Unix socket for browsers in containers without a network: it is mounted into the container. */
    listenUnix(path: string): Promise<void> {
      let p = unix.get(path);
      if (!p) {
        p = rm(path, { force: true }).then(
          () =>
            new Promise<void>((resolve, reject) => {
              const s = createServer(onConnection);
              servers.push(s);
              s.once("error", reject);
              s.listen(path, () => resolve());
            }),
        );
        unix.set(path, p);
      }
      return p;
    },
    close() {
      for (const s of servers) s.close();
    },
  };
}
export type EgressProxy = ReturnType<typeof createEgressProxy>;
