import { IdentityTestTargetError, requireIdentityTestTarget } from "./identity-test-target";
import type { IdentityTestTarget, IdentityTestTargetEnvironment } from "./identity-test-target";

/** Additional restrictions for the one dedicated Compose proof, not the general guard. */
export function requireIdentityProofTarget(
  env: IdentityTestTargetEnvironment & Readonly<Record<string, string | undefined>>,
): IdentityTestTarget {
  try {
    const target = requireIdentityTestTarget(env);
    const url = new URL(target.connectionString);
    // Reject ambient libpq settings before importing pg, including service/pass files,
    // SSL negotiation, options, replication and defaults not represented in the URL.
    if (Object.keys(env).some((key) => /^PG/i.test(key) || key === "NODE_PG_FORCE_NATIVE")
      || url.hostname !== "127.0.0.1" || url.port !== "55432"
      || decodeURIComponent(url.username) !== "zetta_identity_runner"
      || decodeURIComponent(url.password).length === 0) throw new IdentityTestTargetError();
    return target;
  } catch {
    throw new IdentityTestTargetError();
  }
}
