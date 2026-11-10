import { randomBytes } from "node:crypto";
import { readEnv, upsertEnv } from "./env-file";

export type SetupMode = "local" | "lan";

export type SetupInput = {
  mode: SetupMode;
  /** The LAN address; required for `lan`. */
  address?: string;
  server: string;
  web: string;
  /** Random secret source; replaced in tests. */
  secret?: () => string;
};

export type SetupResult = {
  server: string;
  web: string;
  /** Keys written, in order, per file. Values are never listed. */
  changed: { server: string[]; web: string[] };
  /** Set only when this run created it: the browser asks for it at the first onboarding step. */
  setupKey?: string;
  url: string;
};

// Host-run server and Vite use paths relative to each app, as scripts/dev-certs.sh prints them.
const CERT = "../../.certs/localhost.pem";
const KEY = "../../.certs/localhost-key.pem";
const ROOT = "../../.certs/rootCA.pem";

const base64Key = () => randomBytes(32).toString("base64");
const empty = (text: string, key: string) => !readEnv(text, key);

/** Pure: returns the new text of both .env files. Filled secrets are never replaced. */
export function planSetup(input: SetupInput): SetupResult {
  const secret = input.secret ?? base64Key;
  const lan = input.mode === "lan";
  if (lan && !input.address) throw new Error("A LAN address is required for mode lan.");
  const scheme = lan ? "https" : "http";
  const host = lan ? input.address! : "localhost";

  const serverValues: Record<string, string> = {};
  let setupKey: string | undefined;
  for (const key of ["BETTER_AUTH_SECRET", "ZETTA_CONNECTION_KEY", "ZETTA_SETUP_KEY"]) {
    if (!empty(input.server, key)) continue;
    serverValues[key] = secret();
    if (key === "ZETTA_SETUP_KEY") setupKey = serverValues[key];
  }
  // DATABASE_URL is left alone: empty means the Postgres that ships inside Zetta.

  Object.assign(serverValues, {
    BETTER_AUTH_URL: `${scheme}://${host}:3000`,
    CORS_ORIGIN: `${scheme}://${host}:3001`,
    ZETTA_HOST: lan ? "0.0.0.0" : "",
    ZETTA_TLS_CERT: lan ? CERT : "",
    ZETTA_TLS_KEY: lan ? KEY : "",
    NODE_EXTRA_CA_CERTS: lan ? ROOT : "",
  });
  const webValues: Record<string, string> = {
    VITE_SERVER_URL: `${scheme}://${host}:3000`,
    ZETTA_HOST: lan ? "0.0.0.0" : "",
    ZETTA_TLS_CERT: lan ? CERT : "",
    ZETTA_TLS_KEY: lan ? KEY : "",
  };

  return {
    server: upsertEnv(input.server, serverValues),
    web: upsertEnv(input.web, webValues),
    changed: { server: Object.keys(serverValues), web: Object.keys(webValues) },
    setupKey,
    url: `${scheme}://${host}:3001`,
  };
}
