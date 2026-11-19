import { afterEach, describe, expect, test } from "bun:test";
import {
  authorize,
  createPkce,
  discoverEndpoints,
  listenForCallback,
  needsRefresh,
  OAuthError,
  refresh,
  revoke,
  type OAuthEndpoints,
} from "./oauth";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
});

/** A small authorization server: metadata, a token endpoint that checks PKCE, and a revocation endpoint. */
function fakeServer(options: { issuerOnOtherSite?: boolean; noS256?: boolean } = {}) {
  const seen = {
    tokenForms: [] as URLSearchParams[],
    revoked: [] as string[],
    codes: new Map<string, { challenge: string; redirect: string }>(),
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const origin = `http://127.0.0.1:${server.port}`;
      if (url.pathname === "/.well-known/oauth-protected-resource/api/mcp")
        return Response.json({
          resource: `${origin}/api/mcp`,
          authorization_servers: [
            options.issuerOnOtherSite
              ? "https://elsewhere.example.invalid/api/auth"
              : `${origin}/api/auth`,
          ],
        });
      if (url.pathname === "/.well-known/oauth-authorization-server/api/auth")
        return Response.json({
          issuer: `${origin}/api/auth`,
          authorization_endpoint: `${origin}/api/auth/mcp/authorize`,
          token_endpoint: `${origin}/api/auth/mcp/token`,
          revocation_endpoint: `${origin}/api/auth/mcp/revoke`,
          code_challenge_methods_supported: options.noS256 ? ["plain"] : ["S256"],
        });
      if (url.pathname === "/api/auth/mcp/authorize") {
        const code = `code-${seen.codes.size + 1}`;
        seen.codes.set(code, {
          challenge: url.searchParams.get("code_challenge")!,
          redirect: url.searchParams.get("redirect_uri")!,
        });
        const back = new URL(url.searchParams.get("redirect_uri")!);
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state")!);
        return Response.redirect(back.toString(), 302);
      }
      if (url.pathname === "/api/auth/mcp/token") {
        const form = new URLSearchParams(await request.text());
        seen.tokenForms.push(form);
        if (form.get("grant_type") === "refresh_token")
          return form.get("refresh_token") === "refresh-1"
            ? Response.json({
                access_token: "access-2",
                expires_in: 3600,
                refresh_token: "refresh-2",
              })
            : new Response("{}", { status: 400 });
        const code = seen.codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const digest = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
        if (!code || code.challenge !== digest || code.redirect !== form.get("redirect_uri"))
          return new Response("{}", { status: 400 });
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope: "openid offline_access mcp:read mcp:write",
        });
      }
      if (url.pathname === "/api/auth/mcp/revoke") {
        seen.revoked.push(new URLSearchParams(await request.text()).get("token") ?? "");
        return Response.json({});
      }
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  const origin = `http://127.0.0.1:${server.port}`;
  return { origin, seen, origins: { webOrigin: origin, apiOrigin: origin } };
}

/** The person's browser: follows the authorization address, which redirects back to the app's loopback listener. */
const browser =
  (log: string[] = []) =>
  (url: string) => {
    log.push(url);
    void fetch(url).then((res) => res.text());
  };

describe("discovery", () => {
  test("finds the endpoints from the server's own metadata", async () => {
    const s = fakeServer();
    const endpoints = await discoverEndpoints(s.origins);
    expect(endpoints).toMatchObject({
      issuer: `${s.origin}/api/auth`,
      authorization: `${s.origin}/api/auth/mcp/authorize`,
      token: `${s.origin}/api/auth/mcp/token`,
      resource: `${s.origin}/api/mcp`,
    });
  });

  test("refuses an issuer on another site: a server cannot send the app elsewhere to sign in", async () => {
    const s = fakeServer({ issuerOnOtherSite: true });
    await expect(discoverEndpoints(s.origins)).rejects.toMatchObject({ code: "DISCOVERY_FAILED" });
  });

  test("refuses a server that cannot do S256", async () => {
    const s = fakeServer({ noS256: true });
    await expect(discoverEndpoints(s.origins)).rejects.toMatchObject({ code: "DISCOVERY_FAILED" });
  });

  test("a server that answers nothing is reported, not crashed on", async () => {
    await expect(
      discoverEndpoints({ webOrigin: "http://127.0.0.1:1", apiOrigin: "http://127.0.0.1:1" }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("pkce", () => {
  test("the challenge is the SHA-256 of the verifier, and state is random", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.challenge).toBe(new Bun.CryptoHasher("sha256").update(a.verifier).digest("base64url"));
    expect(a.state).not.toBe(b.state);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("sign in", () => {
  test("opens the browser, takes the answer on the loopback listener and trades the code for tokens", async () => {
    const s = fakeServer();
    const opened: string[] = [];
    const endpoints = await discoverEndpoints(s.origins);
    const tokens = await authorize({ endpoints, open: browser(opened), now: () => 1_000 });
    expect(tokens).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1_000 + 3_600_000,
      scope: "openid offline_access mcp:read mcp:write",
    });
    const asked = new URL(opened[0]!);
    expect(asked.searchParams.get("client_id")).toBe(
      "https://zettabot.app/oauth/zetta-desktop.json",
    );
    expect(asked.searchParams.get("code_challenge_method")).toBe("S256");
    expect(asked.searchParams.get("resource")).toBe(`${s.origin}/api/mcp`);
    expect(asked.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(s.seen.tokenForms[0]!.get("code_verifier")).toBeTruthy();
  });

  test("an answer with the wrong state is refused and no code is traded", async () => {
    const s = fakeServer();
    const endpoints = await discoverEndpoints(s.origins);
    const listener = listenForCallback();
    const attempt = authorize({
      endpoints,
      listener,
      open: () => void fetch(`${listener.redirectUri}?code=stolen&state=not-mine`),
    });
    await expect(attempt).rejects.toMatchObject({ code: "STATE_MISMATCH" });
    expect(s.seen.tokenForms).toHaveLength(0);
  });

  test("a refusal in the browser is reported as such", async () => {
    const s = fakeServer();
    const endpoints = await discoverEndpoints(s.origins);
    const listener = listenForCallback();
    const attempt = authorize({
      endpoints,
      listener,
      open: () => void fetch(`${listener.redirectUri}?error=access_denied`),
    });
    await expect(attempt).rejects.toMatchObject({ code: "DENIED" });
  });

  test("waiting for the person has an end", async () => {
    const s = fakeServer();
    const endpoints = await discoverEndpoints(s.origins);
    const attempt = authorize({ endpoints, listener: listenForCallback(30), open: () => {} });
    await expect(attempt).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  test("the listener answers once, and only on /callback", async () => {
    const listener = listenForCallback();
    const base = listener.redirectUri.replace("/callback", "");
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${listener.redirectUri}?code=a&state=b`)).status).toBe(200);
    expect((await fetch(`${listener.redirectUri}?code=c&state=d`)).status).toBe(404);
    expect((await listener.result).get("code")).toBe("a");
    listener.close();
  });
});

describe("refresh and revoke", () => {
  const endpoints = (origin: string): OAuthEndpoints => ({
    issuer: `${origin}/api/auth`,
    authorization: `${origin}/api/auth/mcp/authorize`,
    token: `${origin}/api/auth/mcp/token`,
    revocation: `${origin}/api/auth/mcp/revoke`,
    resource: `${origin}/api/mcp`,
  });
  const held = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: 0,
    scope: "openid",
  };

  test("a new access token, keeping the refresh token the server rotated to", async () => {
    const s = fakeServer();
    const next = await refresh({ endpoints: endpoints(s.origin), tokens: held, now: () => 5_000 });
    expect(next).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: 5_000 + 3_600_000,
    });
  });

  test("a refused refresh token is an error, and no refresh token is its own error", async () => {
    const s = fakeServer();
    await expect(
      refresh({ endpoints: endpoints(s.origin), tokens: { ...held, refreshToken: "revoked" } }),
    ).rejects.toMatchObject({ code: "REFRESH_FAILED" });
    await expect(
      refresh({ endpoints: endpoints(s.origin), tokens: { ...held, refreshToken: null } }),
    ).rejects.toMatchObject({ code: "NO_REFRESH" });
  });

  test("revoking sends both tokens to the server", async () => {
    const s = fakeServer();
    expect(await revoke({ endpoints: endpoints(s.origin), tokens: held })).toBe(true);
    expect(s.seen.revoked.sort()).toEqual(["access-1", "refresh-1"]);
    expect(
      await revoke({ endpoints: { ...endpoints(s.origin), revocation: null }, tokens: held }),
    ).toBe(false);
  });

  test("an access token is replaced a minute before it ends", () => {
    expect(needsRefresh({ ...held, expiresAt: 100_000 }, 30_000)).toBe(false);
    expect(needsRefresh({ ...held, expiresAt: 100_000 }, 50_000)).toBe(true);
  });
});
