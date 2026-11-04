import type { NetworkInterfaceInfo } from "node:os";

type Interfaces = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>;

const isPrivate = (ip: string) => {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** Private IPv4 addresses of this machine (10/8, 172.16/12, 192.168/16), without loopback. */
export function lanAddresses(interfaces: Interfaces): string[] {
  return Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal && isPrivate(i.address))
    .map((i) => i.address);
}

/** An IPv4 address or a host name. The value goes into URLs and the mkcert command line, so nothing else passes. */
export const isHost = (value: string) => /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value);
