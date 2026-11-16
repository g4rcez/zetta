import { networkInterfaces } from "node:os";

type Interfaces = ReturnType<typeof networkInterfaces>;

/**
 * Origins a browser can use to reach this machine: `localhost` and every address of every network interface (Wi-Fi, Ethernet, Tailscale, VPN),
 * with the scheme and port of the public address. Better Auth and CORS trust them, so Zetta answers on all interfaces with no per-address
 * setting. An origin is only trusted when the page was served from this machine's own address, which a website on the internet cannot be.
 *
 * Read at boot: an interface that comes up later (Tailscale started after Zetta) needs a restart.
 */
export function localOrigins(
  publicUrl: string,
  interfaces: Interfaces = networkInterfaces(),
): string[] {
  const base = new URL(publicUrl);
  const hosts = new Set<string>(["localhost"]);
  for (const list of Object.values(interfaces))
    for (const entry of list ?? []) {
      // fe80::/10 needs a zone id (`fe80::1%en0`), which a browser never sends as an Origin.
      if (entry.family === "IPv6" && /^fe[89ab]/i.test(entry.address)) continue;
      hosts.add(entry.family === "IPv6" ? `[${entry.address}]` : entry.address);
    }
  return [...hosts].map((host) => `${base.protocol}//${host}${base.port ? `:${base.port}` : ""}`);
}
