import { CLIENT_IP_HEADER } from "@zetta/auth/client-ip-header";

/**
 * The address the auth rate limiter counts a request against. Without a trusted proxy it is the socket address. Behind a reverse proxy
 * the operator names the one header that proxy sets (`ZETTA_TRUSTED_IP_HEADER`, for example `x-forwarded-for` or `cf-connecting-ip`);
 * the last entry is used because that is the hop the trusted proxy added, while earlier entries can be written by the client.
 */
export function clientIp(
  request: Request,
  socketAddress: string | undefined,
  trustedHeader = process.env.ZETTA_TRUSTED_IP_HEADER,
): string | undefined {
  const name = trustedHeader?.trim().toLowerCase();
  if (name) {
    const entries = (request.headers.get(name) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }
  return socketAddress;
}

/** Writes the counted address into the header Better Auth reads, replacing any value the client sent. */
export function stampClientIp(request: Request, socketAddress: string | undefined) {
  request.headers.delete(CLIENT_IP_HEADER);
  const ip = clientIp(request, socketAddress);
  if (ip) request.headers.set(CLIENT_IP_HEADER, ip);
}
