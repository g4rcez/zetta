export type IdentityTestTargetEnvironment = Readonly<{
  ZETTA_TEST_DATABASE_URL?: string;
  ZETTA_TEST_DATABASE_ALLOW_MUTATION?: string;
  DATABASE_URL?: string;
}>;

export type IdentityTestTarget = Readonly<{ connectionString: string }>;

export class IdentityTestTargetError extends Error {
  constructor() {
    super("Identity database test target is unavailable or unsafe.");
    this.name = "IdentityTestTargetError";
  }
}

function endpoint(connectionString: string) {
  // Check the raw form first: URL parsing alone can erase whitespace/path tricks.
  const parts = /^(postgres|postgresql):\/\/([^/?#\\\s]+)\/([^/?#\\\s]+)$/i.exec(connectionString);
  // oxlint-disable-next-line no-control-regex
  if (!parts || parts[0] !== connectionString || /[\u0000-\u001f\u007f]/.test(connectionString)) {
    throw new IdentityTestTargetError();
  }
  const authority = parts[2]!;
  const address = /^(?:[^@,]*@)?(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]+))?$/i.exec(authority);
  if (!address) throw new IdentityTestTargetError();
  const port = address[2] === undefined ? 5432 : Number(address[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new IdentityTestTargetError();

  const url = new URL(connectionString);
  // A disappearing dot path lets pg default the database to the username.
  if (url.pathname !== `/${parts[3]}`) throw new IdentityTestTargetError();
  // Validate escapes without retaining or exposing credentials in diagnostics.
  decodeURIComponent(url.username);
  decodeURIComponent(url.password);
  // HTTP URL parsing canonicalizes IPv4 shorthand and expanded IPv6 without DNS/IO.
  const hostname = new URL(`http://${address[1]}`).hostname.toLowerCase().replace(/\.$/, "");
  const host = ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ? "loopback" : hostname;
  return {
    host,
    port,
    database: decodeURIComponent(parts[3]!),
    rawHost: address[1]!,
    rawPath: parts[3]!,
  };
}

/** Pure pre-client boundary, not proof of operator approval or database disposability. */
export function requireIdentityTestTarget(env: IdentityTestTargetEnvironment): IdentityTestTarget {
  try {
    const connectionString = env.ZETTA_TEST_DATABASE_URL;
    if (
      env.ZETTA_TEST_DATABASE_ALLOW_MUTATION !== "identity-tests" ||
      typeof connectionString !== "string" ||
      connectionString.length === 0
    ) {
      throw new IdentityTestTargetError();
    }
    const target = endpoint(connectionString);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(target.rawHost.toLowerCase()) ||
      target.rawPath !== "zetta_identity_test"
    ) {
      throw new IdentityTestTargetError();
    }

    if (env.DATABASE_URL !== undefined) {
      if (typeof env.DATABASE_URL !== "string") throw new IdentityTestTargetError();
      const application = endpoint(env.DATABASE_URL);
      if (
        target.host === application.host &&
        target.port === application.port &&
        target.database === application.database
      ) {
        throw new IdentityTestTargetError();
      }
    }
    // Pin the effective port so a future driver cannot substitute ambient PGPORT.
    const validated = new URL(connectionString);
    validated.port = String(target.port);
    return Object.freeze({ connectionString: validated.href });
  } catch {
    // Never propagate URL-parser/input errors or attach sensitive causes.
    throw new IdentityTestTargetError();
  }
}
