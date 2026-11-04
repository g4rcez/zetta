import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { requireMcpAuth, type McpGuardAuth } from "./mcp-guard";

type Jwk = NonNullable<Awaited<ReturnType<McpGuardAuth["api"]["getJwks"]>>>["keys"][number];

const ISSUER = "https://zetta.example.invalid/api/auth";
const RESOURCE = "https://zetta.example.invalid/api/mcp";
const b64 = (input: string | Uint8Array) => Buffer.from(input).toString("base64url");

type Pair = { privateKey: CryptoKey; jwk: Jwk & { kid: string } };
async function newPair(kid: string): Promise<Pair> {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid,
    alg: "EdDSA",
  } as Pair["jwk"];
  return { privateKey: keys.privateKey, jwk };
}
async function sign(pair: Pair, claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "EdDSA", kid: pair.jwk.kid, typ: "JWT" }));
  const body = b64(
    JSON.stringify({
      iss: ISSUER,
      aud: RESOURCE,
      sub: "user-1",
      scope: "mcp:read",
      iat: now,
      exp: now + 600,
      ...claims,
    }),
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    Buffer.from(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(new Uint8Array(signature))}`;
}

describe("requireMcpAuth: MCP access tokens checked in process", () => {
  const realFetch = globalThis.fetch;
  let trusted: Pair;
  let stranger: Pair;
  beforeAll(async () => {
    trusted = await newPair("key-1");
    stranger = await newPair("key-1");
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const auth = (getJwks: McpGuardAuth["api"]["getJwks"]): McpGuardAuth => ({
    $context: Promise.resolve({ baseURL: ISSUER }),
    api: { getJwks },
  });
  const guard = (getJwks?: McpGuardAuth["api"]["getJwks"]) =>
    requireMcpAuth(
      auth(getJwks ?? (async () => ({ keys: [trusted.jwk] }))),
      (_request, claims) => Response.json({ sub: claims.sub }),
      { resource: RESOURCE, requiredScopes: ["mcp:read"] },
    );
  const call = (handle: ReturnType<typeof guard>, authorization?: string) =>
    handle(
      new Request(RESOURCE, { method: "POST", headers: authorization ? { authorization } : {} }),
    );

  test("a valid token reaches the handler with its claims, and the server never calls itself", async () => {
    globalThis.fetch = (() => {
      throw new Error("the guard must not make HTTP calls");
    }) as never;
    const res = await call(guard(), `Bearer ${await sign(trusted, {})}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: "user-1" });
  });

  test("a request without a token gets a 401 challenge", async () => {
    const res = await call(guard());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  test.each([
    ["expired", { exp: 1_000_000_000 }],
    ["for another audience", { aud: "https://other.example.invalid/api/mcp" }],
    ["from another issuer", { iss: "https://other.example.invalid/api/auth" }],
  ])("a token %s gets a 401", async (_label, claims) => {
    const res = await call(guard(), `Bearer ${await sign(trusted, claims)}`);
    expect(res.status).toBe(401);
  });

  test("a token signed with an unknown key gets a 401", async () => {
    const res = await call(guard(), `Bearer ${await sign(stranger, {})}`);
    expect(res.status).toBe(401);
  });

  test("a text that is not a token gets a 401", async () => {
    const res = await call(guard(), "Bearer not-a-token");
    expect(res.status).toBe(401);
  });

  test("a token without mcp:read gets a 403 step-up challenge naming the scope", async () => {
    const res = await call(guard(), `Bearer ${await sign(trusted, { scope: "openid" })}`);
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(res.headers.get("www-authenticate")).toContain("mcp:read");
  });

  test("a DPoP-bound token and the DPoP scheme are refused", async () => {
    const bound = await sign(trusted, { cnf: { jkt: "thumbprint" } });
    expect((await call(guard(), `Bearer ${bound}`)).status).toBe(401);
    expect((await call(guard(), `DPoP ${await sign(trusted, {})}`)).status).toBe(401);
  });

  test("when the signing keys cannot be read the request fails with the error, not a 401", async () => {
    const handle = guard(async () => {
      throw new Error("database down");
    });
    await expect(call(handle, `Bearer ${await sign(trusted, {})}`)).rejects.toThrow(
      "database down",
    );
  });
});
