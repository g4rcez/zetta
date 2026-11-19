import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuthError, type OAuthEndpoints, type Tokens } from "./oauth";
import { createRegistry } from "./registry";
import { createRemoteLink } from "./remote-link";
import { createTokenStore } from "./token-store";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zetta-link-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const endpoints: OAuthEndpoints = {
  issuer: "https://cloud.example.invalid/api/auth",
  authorization: "https://cloud.example.invalid/a",
  token: "https://cloud.example.invalid/t",
  revocation: "https://cloud.example.invalid/r",
  resource: "https://cloud.example.invalid/api/mcp",
};
const tokens = (access: string, expiresAt = 10_000_000): Tokens => ({
  accessToken: access,
  refreshToken: "refresh",
  expiresAt,
  scope: "openid",
});

function setup(options: { localUp?: boolean; localStatus?: number } = {}) {
  const registry = createRegistry(join(root, "servers.json"));
  const remote = registry.add({
    kind: "remote",
    webOrigin: "https://cloud.example.invalid",
    apiOrigin: "https://cloud.example.invalid",
  });
  const store = createTokenStore(join(root, "tokens.json"));
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] =
    [];
  const log = { discover: 0, authorize: 0, refresh: 0, revoked: 0, changed: 0 };
  let localUp = options.localUp ?? true;
  let localStatus = options.localStatus ?? 200;
  let refreshing: () => Promise<Tokens> = async () => tokens("access-2");
  let clock = 1_000;
  const link = createRemoteLink({
    registry,
    tokens: store,
    open: () => {},
    local: () => (localUp ? { origin: "http://127.0.0.1:44000", token: "link-token" } : null),
    now: () => clock,
    fetcher: async (url, init) => {
      calls.push({
        method: init?.method ?? "GET",
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "null")),
      });
      return new Response("{}", { status: localStatus });
    },
    discover: async () => (log.discover++, endpoints),
    authorize: async () => (log.authorize++, tokens("access-1")),
    refresh: async () => (log.refresh++, refreshing()),
    revoke: async () => (log.revoked++, true),
    onChange: () => void log.changed++,
  });
  return {
    link,
    registry,
    remote,
    store,
    calls,
    log,
    setLocal: (up: boolean, status = 200) => ((localUp = up), (localStatus = status)),
    setRefresh: (fn: () => Promise<Tokens>) => (refreshing = fn),
    advance: (ms: number) => (clock += ms),
  };
}

describe("connecting", () => {
  test("signs in, keeps the tokens in a private file and gives the local server the access token", async () => {
    const s = setup();
    expect(s.link.state(s.remote.id).status).toBe("disconnected");
    expect(await s.link.connect(s.remote.id)).toEqual({ status: "connected" });
    expect(s.link.state(s.remote.id)).toMatchObject({ status: "connected", localLinked: true });
    expect(s.store.get(s.remote.id)?.tokens.accessToken).toBe("access-1");
    expect(statSync(join(root, "tokens.json")).mode & 0o777).toBe(0o600);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({
      method: "PUT",
      url: "http://127.0.0.1:44000/api/desktop/remotes",
      headers: { "x-zetta-desktop-link": "link-token" },
      body: { origin: "https://cloud.example.invalid", accessToken: "access-1" },
    });
  });

  test("with the local server down, it is connected but not linked yet, and the next tick links it", async () => {
    const s = setup({ localUp: false });
    await s.link.connect(s.remote.id);
    expect(s.link.state(s.remote.id)).toMatchObject({ status: "connected", localLinked: false });
    s.setLocal(true);
    await s.link.tick();
    expect(s.link.state(s.remote.id).localLinked).toBe(true);
  });

  test("before the owner has signed up (409) it stays unlinked and tries again later", async () => {
    const s = setup({ localStatus: 409 });
    await s.link.connect(s.remote.id);
    expect(s.link.state(s.remote.id).localLinked).toBe(false);
    s.setLocal(true, 200);
    await s.link.tick();
    expect(s.link.state(s.remote.id).localLinked).toBe(true);
  });

  test("a failed sign-in reports why and stores nothing", async () => {
    const s = setup();
    const failing = createRemoteLink({
      registry: s.registry,
      tokens: s.store,
      open: () => {},
      local: () => null,
      discover: async () => endpoints,
      authorize: async () => {
        throw new OAuthError("DENIED");
      },
    });
    expect(await failing.connect(s.remote.id)).toEqual({ status: "failed", error: "DENIED" });
    expect(s.store.ids()).toEqual([]);
  });

  test("only a remote server can be connected, not this computer's own", async () => {
    const s = setup();
    const local = s.registry.setLocal({
      webOrigin: "http://127.0.0.1:44000",
      apiOrigin: "http://127.0.0.1:44000",
    });
    expect(await s.link.connect(local.id)).toEqual({ status: "failed", error: "NOT_REMOTE" });
  });
});

describe("keeping tokens fresh", () => {
  test("a token near its end is renewed and the new one is handed to the local server", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    s.advance(9_990_000);
    await s.link.tick();
    expect(s.log.refresh).toBe(1);
    expect(s.store.get(s.remote.id)?.tokens.accessToken).toBe("access-2");
    expect(s.calls.at(-1)?.body).toMatchObject({ accessToken: "access-2" });
  });

  test("a token that is still good is not renewed, and nothing is sent twice", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    await s.link.tick();
    await s.link.tick();
    expect(s.log.refresh).toBe(0);
    expect(s.calls).toHaveLength(1);
  });

  test("a refused refresh asks for a new sign-in, a network failure does not", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    s.advance(9_990_000);
    s.setRefresh(async () => {
      throw new Error("offline");
    });
    await s.link.tick();
    expect(s.link.state(s.remote.id).status).toBe("connected");
    s.setRefresh(async () => {
      throw new OAuthError("REFRESH_FAILED");
    });
    await s.link.tick();
    expect(s.link.state(s.remote.id).status).toBe("signin-needed");
    s.setRefresh(async () => tokens("access-3"));
    await s.link.connect(s.remote.id);
    expect(s.link.state(s.remote.id).status).toBe("connected");
  });

  test("when the local server restarts it is given the token again", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    s.link.localRestarted();
    expect(s.link.state(s.remote.id).localLinked).toBe(false);
    await s.link.tick();
    expect(s.calls).toHaveLength(2);
    expect(s.link.state(s.remote.id).localLinked).toBe(true);
  });
});

describe("disconnecting", () => {
  test("removes the local server's way in, tells the remote, and forgets the tokens", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    expect(await s.link.disconnect(s.remote.id)).toBe(true);
    expect(s.calls.at(-1)).toMatchObject({
      method: "DELETE",
      body: { origin: "https://cloud.example.invalid" },
    });
    expect(s.log.revoked).toBe(1);
    expect(s.store.ids()).toEqual([]);
    expect(s.link.state(s.remote.id).status).toBe("disconnected");
    expect(await s.link.disconnect(s.remote.id)).toBe(false);
  });

  test("the tokens are forgotten even when nothing can be reached", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    s.setLocal(false);
    await s.link.disconnect(s.remote.id);
    expect(s.store.ids()).toEqual([]);
  });
});

describe("token file", () => {
  test("survives a restart, and a damaged one is moved aside", async () => {
    const s = setup();
    await s.link.connect(s.remote.id);
    expect(createTokenStore(join(root, "tokens.json")).get(s.remote.id)?.tokens.refreshToken).toBe(
      "refresh",
    );
    await Bun.write(join(root, "tokens.json"), "{ nope");
    expect(createTokenStore(join(root, "tokens.json"), () => new Date(5)).ids()).toEqual([]);
    expect(await Bun.file(join(root, "tokens.json.unreadable-5")).text()).toBe("{ nope");
  });
});
