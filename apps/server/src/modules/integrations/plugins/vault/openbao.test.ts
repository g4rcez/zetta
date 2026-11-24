import { beforeEach, describe, expect, test } from "bun:test";
import { PluginError, type PluginContext } from "../registry";
import { configureVault } from "./exec";
import { OPENBAO, resetOpenBaoState } from "./openbao";

/** A fake OpenBao over fetch: records every request (method, path, headers) and answers from a handler. Real-server runs are in vault-real.test.ts. */
type Call = { method: string; url: URL; headers: Record<string, string>; body?: unknown };
const calls: Call[] = [];
let answer: (c: Call) => { status?: number; body?: unknown } = () => ({ status: 404 });
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const call: Call = {
    method: init?.method ?? "GET",
    url: new URL(String(input)),
    headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
  calls.push(call);
  const r = answer(call);
  return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
    status: r.status ?? 200,
  });
}) as typeof fetch;
const ctx = (config: Record<string, string>, userId = "u1"): PluginContext => {
  const self = {
    userId,
    config,
    async setConfig(next: Record<string, string>) {
      self.config = { ...next };
    },
  };
  return self as never;
};
const BASE = "https://bao.example.invalid:8200",
  TOKEN = "s.FAKE_TOKEN_123",
  SEED = "JBSWY3DPEHPK3PXP";
const kv2: Record<string, { data: Record<string, unknown>; custom?: Record<string, unknown> }> = {
  "web/github": {
    data: { Username: "octocat", password: "hunter2", totp: SEED, url: "https://github.com/login" },
  },
  other: { data: { user: "u2", pass: "p2" }, custom: { sites: "example.com *.example.org" } },
  notes: { data: { note: "nothing to fill" } },
};
const server: typeof answer = (c) => {
  const p = c.url.pathname;
  if (p === "/v1/auth/token/lookup-self") return { body: { data: {} } };
  if (p === "/v1/sys/internal/ui/mounts/secret")
    return { body: { data: { options: { version: "2" } } } };
  if (p === "/v1/sys/internal/ui/mounts/kv1") return { body: { data: { options: null } } };
  if (p === "/v1/secret/metadata/" && c.url.searchParams.get("list") === "true")
    return { body: { data: { keys: ["notes", "other", "web/"] } } };
  if (p === "/v1/secret/metadata/web/") return { body: { data: { keys: ["github"] } } };
  const m = /^\/v1\/secret\/data\/(.+)$/.exec(p);
  if (m && kv2[m[1]!])
    return {
      body: {
        data: { data: kv2[m[1]!]!.data, metadata: { custom_metadata: kv2[m[1]!]!.custom ?? null } },
      },
    };
  if (p === "/v1/kv1/" && c.url.searchParams.get("list") === "true")
    return { body: { data: { keys: ["site1"] } } };
  if (p === "/v1/kv1/site1") return { body: { data: { username: "v1u", password: "v1p" } } };
  return { status: 404 };
};
beforeEach(() => {
  calls.length = 0;
  answer = server;
  resetOpenBaoState();
  configureVault({ fetch: fakeFetch, allowPrivate: true });
});
const items = async (c: PluginContext) =>
  (await OPENBAO.connect!(c, { browse: {} }))!.data!.items as {
    id: string;
    urls: string[];
    fields: string[];
  }[];

describe("OpenBao", () => {
  test("token: KV v2 secrets with login-like keys, sites from a url key or custom metadata, no value in the listing", async () => {
    const c = ctx({ baseUrl: BASE, token: TOKEN });
    await OPENBAO.install!(c);
    const list = await items(c);
    expect(list.map((i) => [i.id, i.fields, i.urls])).toEqual([
      ["other", ["username", "password"], ["example.com", "*.example.org"]],
      ["web/github", ["username", "password", "totp"], ["https://github.com/login"]],
    ]);
    expect(JSON.stringify(list)).not.toContain("hunter2");
    expect(await OPENBAO.credentials!.reveal(c, "web/github", "username")).toBe("octocat");
    expect(await OPENBAO.credentials!.reveal(c, "web/github", "password")).toBe("hunter2");
    expect(await OPENBAO.credentials!.reveal(c, "web/github", "totp")).toMatch(/^\d{6}$/);
    expect(calls.every((x) => x.headers["X-Vault-Token"] === TOKEN)).toBe(true);
    expect(calls.every((x) => !x.url.href.includes(TOKEN))).toBe(true);
  });
  test("grant, then the bot tool lists refs without values", async () => {
    const c = ctx({ baseUrl: BASE, token: TOKEN });
    await OPENBAO.connect!(c, { grant: { id: "web/github" } });
    const tool = OPENBAO.tools!.find((t) => t.name === "list_credentials")!;
    const r = JSON.stringify(await tool.handler(c, {} as never));
    expect(r).toContain("openbao:web/github");
    expect(r).not.toContain("hunter2");
  });
  test("the namespace header is sent when set, and only then", async () => {
    await items(ctx({ baseUrl: BASE, token: TOKEN, namespace: "/team1/" }));
    expect(calls.every((x) => x.headers["X-Vault-Namespace"] === "team1")).toBe(true);
    calls.length = 0;
    await items(ctx({ baseUrl: BASE, token: TOKEN }));
    expect(calls.some((x) => "X-Vault-Namespace" in x.headers)).toBe(false);
  });
  test("a mount that reports no version 2 is read as KV v1", async () => {
    const c = ctx({ baseUrl: BASE, token: TOKEN, mount: "kv1" });
    expect((await items(c)).map((i) => i.id)).toEqual(["site1"]);
    expect(await OPENBAO.credentials!.reveal(c, "site1", "password")).toBe("v1p");
    expect(calls.some((x) => x.url.pathname.includes("/data/"))).toBe(false);
  });
  test("AppRole: logs in once, reuses the token, and the secret id is only in the login body", async () => {
    answer = (c) =>
      c.url.pathname === "/v1/auth/approle/login"
        ? { body: { auth: { client_token: "s.APPROLE_TOKEN", lease_duration: 3600 } } }
        : server(c);
    const c = ctx({ baseUrl: BASE, roleId: "role-1", secretId: "secret-id-xyz" });
    await OPENBAO.install!(c);
    await items(c);
    const logins = calls.filter((x) => x.url.pathname === "/v1/auth/approle/login");
    expect(logins).toHaveLength(1);
    expect(logins[0]!.body).toEqual({ role_id: "role-1", secret_id: "secret-id-xyz" });
    expect(JSON.stringify(calls.filter((x) => x !== logins[0]))).not.toContain("secret-id-xyz");
    expect(
      calls
        .filter((x) => x !== logins[0])
        .every((x) => x.headers["X-Vault-Token"] === "s.APPROLE_TOKEN"),
    ).toBe(true);
  });
  test("AppRole: a bad login is AUTH, and a new secret id is not served from the old token", async () => {
    answer = (c) => (c.url.pathname === "/v1/auth/approle/login" ? { status: 400 } : server(c));
    const e = (await OPENBAO.install!(ctx({ baseUrl: BASE, roleId: "r", secretId: "bad" })).catch(
      (x) => x,
    )) as PluginError;
    expect(e.code).toBe("AUTH");
    expect(`${e.safe} ${e.fix}`).not.toContain("bad");
  });
  test("403 is AUTH and errors never echo the server's answer", async () => {
    answer = () => ({ status: 403, body: { errors: [`permission denied for ${TOKEN}`] } });
    const e = (await OPENBAO.install!(ctx({ baseUrl: BASE, token: TOKEN })).catch(
      (x) => x,
    )) as PluginError;
    expect(e.code).toBe("AUTH");
    expect(`${e.safe} ${e.fix}`).not.toContain(TOKEN);
  });
  test("private addresses follow the platform policy, and nothing is sent", async () => {
    configureVault({ allowPrivate: false });
    const e = (await OPENBAO.install!(
      ctx({ baseUrl: "http://127.0.0.1:8200", token: TOKEN }),
    ).catch((x) => x)) as PluginError;
    expect(e.code).toBe("BLOCKED_URL");
    expect(calls).toHaveLength(0);
  });
  test("plain http to a public address is refused before the token is sent", async () => {
    configureVault({ allowPrivate: false });
    const e = (await OPENBAO.install!(ctx({ baseUrl: "http://8.8.8.8:8200", token: TOKEN })).catch(
      (x) => x,
    )) as PluginError;
    expect(e.code).toBe("INVALID_FIELD");
    expect(calls).toHaveLength(0);
  });
  test("a prefix limits listing and reveal; unsafe paths never reach the server", async () => {
    const c = ctx({ baseUrl: BASE, token: TOKEN, prefix: "web" });
    expect((await items(c)).map((i) => i.id)).toEqual(["web/github"]);
    for (const id of ["other", "web/../other", "../x", "web//x"])
      await expect(OPENBAO.credentials!.reveal(c, id, "password")).rejects.toThrow();
    expect(calls.some((x) => x.url.pathname.includes(".."))).toBe(false);
  });
  test("exactly one sign-in style, and a bad address or mount is refused", async () => {
    await expect(OPENBAO.install!(ctx({ baseUrl: BASE }))).rejects.toThrow("MISSING_FIELD");
    await expect(
      OPENBAO.install!(ctx({ baseUrl: BASE, token: TOKEN, roleId: "r", secretId: "s" })),
    ).rejects.toThrow("INVALID_FIELD");
    await expect(OPENBAO.install!(ctx({ baseUrl: "not a url", token: TOKEN }))).rejects.toThrow(
      "INVALID_FIELD",
    );
    await expect(
      OPENBAO.install!(ctx({ baseUrl: BASE, token: TOKEN, mount: "../sys" })),
    ).rejects.toThrow("INVALID_FIELD");
    expect(calls).toHaveLength(0);
  });
  test("bot CLI: off by default, then mounts and secret paths as metadata", async () => {
    const cli = OPENBAO.tools!.find((t) => t.name === "cli")!;
    const base = { baseUrl: BASE, token: TOKEN };
    await expect(cli.handler(ctx(base), { command: "bao kv list" } as never)).rejects.toThrow(
      "CLI_DISABLED",
    );
    const r = JSON.stringify(
      await cli.handler(ctx({ ...base, cliAccess: "metadata" }), {
        command: "bao kv list",
      } as never),
    );
    expect(r).toContain("web/github");
    expect(r).not.toContain("hunter2");
    await expect(
      cli.handler(ctx({ ...base, cliAccess: "metadata" }), {
        command: "bao read secret/data/other",
      } as never),
    ).rejects.toThrow("CLI_COMMAND");
  });
});
