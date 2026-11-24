import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext, PluginDef } from "../registry";
import { BITWARDEN, resetBitwardenSessions } from "./bitwarden";
import { configureVault, spawnExec } from "./exec";
import { OPENBAO, resetOpenBaoState } from "./openbao";
import { totp } from "./totp";
import { engine, freePort, registerVaultwarden, waitUntil } from "./vault-real-setup";

/**
 * The password-manager plugins against REAL servers started here, in local containers: OpenBao (dev mode) and Vaultwarden (the
 * self-hosted Bitwarden server, through the real `bw` CLI). 1Password and Bitwarden's hosted service have no free test account, so
 * those stay covered by the fakes in vault.test.ts.
 *
 * Opt-in, never part of the default run:
 *   ZETTA_VAULT_TEST=1 ZETTA_DOCKER_BIN=podman bun test src/modules/integrations/plugins/vault/vault-real.test.ts
 * Needs the engine CLI as `ZETTA_DOCKER_BIN` (default docker; Bun cannot spawn a shell function, so give a path on a Mac), the images
 * (pulled on first use), `openssl`, and the `bw` CLI on PATH (otherwise the Vaultwarden part is skipped; `bunx @bitwarden/cli` works
 * from a throwaway folder). Vaultwarden runs with a self-signed certificate because `bw` refuses http servers: the test points
 * NODE_EXTRA_CA_CERTS at it, which also proves the server's CA setting reaches the CLI.
 * Everything it starts is removed afterwards.
 */
const enabled = process.env.ZETTA_VAULT_TEST === "1";
const RUN = `zetta-vault-test-${Date.now().toString(36)}`;
const ROOT_TOKEN = "dev-root-token-test",
  MASTER = "Test-master-pw-1!",
  EMAIL = "vault-test@example.invalid",
  SEED = "JBSWY3DPEHPK3PXP";
const hasBw = Boolean(Bun.which("bw")) && Boolean(Bun.which("openssl"));

const ctxOf = (
  config: Record<string, string>,
  userId = "u1",
): PluginContext & { config: Record<string, string> } => {
  const self = {
    userId,
    config,
    async setConfig(next: Record<string, string>) {
      self.config = { ...next };
    },
  };
  return self as never;
};
const browse = async (p: PluginDef, c: PluginContext) =>
  (await p.connect!(c, { browse: {} }))!.data!.items as {
    id: string;
    title: string;
    urls: string[];
    fields: string[];
  }[];
const reveal = (p: PluginDef, c: PluginContext, id: string, f: "username" | "password" | "totp") =>
  p.credentials!.reveal(c, id, f);
const failure = async (work: Promise<unknown>) =>
  (await work.then(
    () => undefined,
    (e) => e,
  )) as { code: string; safe: string; fix?: string } | undefined;
/** A TOTP code is right when it equals the code for this, the previous or the next 30-second step. */
const codes = () => [-30_000, 0, 30_000].map((d) => totp(SEED, Date.now() + d));

describe.skipIf(!enabled)("OpenBao (real server in dev mode)", () => {
  const port = freePort(),
    base = `http://127.0.0.1:${port}`;
  const bao = (method: string, path: string, body?: unknown, ns?: string) =>
    fetch(`${base}/v1/${path}`, {
      method,
      headers: {
        "X-Vault-Token": ROOT_TOKEN,
        ...(ns ? { "X-Vault-Namespace": ns } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${method} ${path} answered ${r.status}`);
      const text = await r.text();
      return text ? (JSON.parse(text) as Record<string, any>) : {};
    });
  let approle: { roleId: string; secretId: string };

  beforeAll(async () => {
    configureVault({ allowPrivate: true, exec: spawnExec });
    await engine([
      "run",
      "-d",
      "--name",
      `${RUN}-bao`,
      "-p",
      `127.0.0.1:${port}:8200`,
      "-e",
      `BAO_DEV_ROOT_TOKEN_ID=${ROOT_TOKEN}`,
      "docker.io/openbao/openbao:latest",
      "server",
      "-dev",
      "-dev-listen-address=0.0.0.0:8200",
    ]);
    await waitUntil(async () => (await fetch(`${base}/v1/sys/health`)).ok, "OpenBao");
    const kv = (path: string, data: object) => bao("POST", `secret/data/${path}`, { data });
    await kv("web/github", {
      username: "octocat",
      password: "hunter2-test",
      totp: SEED,
      url: "https://github.com/login",
    });
    await kv("other", { username: "u2", password: "p2" });
    await kv("notes-only", { note: "no login keys here" });
    await bao("POST", "secret/metadata/other", {
      custom_metadata: { sites: "example.com, *.example.org" },
    });
    await bao("POST", "sys/mounts/kv1", { type: "kv", options: { version: "1" } });
    await bao("POST", "kv1/site1", {
      username: "v1user",
      password: "v1pass",
      website: "https://v1.example.com",
    });
    await bao("POST", "sys/namespaces/team1");
    await bao("POST", "sys/mounts/ns-kv", { type: "kv", options: { version: "2" } }, "team1");
    await bao(
      "POST",
      "ns-kv/data/app",
      { data: { username: "nsuser", password: "nspass" } },
      "team1",
    );
    await bao("POST", "sys/auth/approle", { type: "approle" });
    await bao("PUT", "sys/policies/acl/zetta-read", {
      policy:
        'path "secret/data/*" {capabilities=["read"]}\npath "secret/metadata/*" {capabilities=["list","read"]}\npath "sys/internal/ui/mounts/*" {capabilities=["read"]}',
    });
    await bao("POST", "auth/approle/role/zetta", {
      token_policies: ["zetta-read"],
      token_ttl: "1h",
    });
    approle = {
      roleId: (await bao("GET", "auth/approle/role/zetta/role-id")).data.role_id,
      secretId: (await bao("POST", "auth/approle/role/zetta/secret-id")).data.secret_id,
    };
  }, 120_000);
  afterAll(async () => {
    await engine(["rm", "-f", `${RUN}-bao`], true);
  });
  const tokenCtx = (extra: Record<string, string> = {}, userId = "u1") =>
    ctxOf({ baseUrl: base, token: ROOT_TOKEN, ...extra }, userId);

  test("token sign-in: lists KV v2 secrets as metadata (keys decide the fields, sites from a url key or custom metadata) and reveals each field", async () => {
    resetOpenBaoState();
    const c = tokenCtx();
    await OPENBAO.install!(c);
    const items = await browse(OPENBAO, c);
    expect(items.map((i) => [i.id, i.fields, i.urls])).toEqual([
      ["other", ["username", "password"], ["example.com", "*.example.org"]],
      ["web/github", ["username", "password", "totp"], ["https://github.com/login"]],
    ]);
    expect(JSON.stringify(items)).not.toContain("hunter2-test");
    expect(await reveal(OPENBAO, c, "web/github", "username")).toBe("octocat");
    expect(await reveal(OPENBAO, c, "web/github", "password")).toBe("hunter2-test");
    expect(codes()).toContain(await reveal(OPENBAO, c, "web/github", "totp"));
    expect((await failure(reveal(OPENBAO, c, "gone", "password")))?.code).toBe("ITEM_NOT_FOUND");
  });
  test("sharing a login and the bot's list: grant keeps sites, the tool returns refs without values", async () => {
    resetOpenBaoState();
    const c = tokenCtx();
    await OPENBAO.connect!(c, { grant: { id: "web/github" } });
    const grants = await OPENBAO.credentials!.grants(c);
    expect(grants).toEqual([
      {
        id: "web/github",
        title: "web/github",
        origins: ["github.com"],
        fields: ["username", "password"],
      },
    ]);
    const listed = await OPENBAO.tools!.find((t) => t.name === "list_credentials")!.handler(
      c,
      {} as never,
    );
    expect(JSON.stringify(listed)).toContain("openbao:web/github");
    expect(JSON.stringify(listed)).not.toContain("hunter2-test");
    const typed = await failure(
      OPENBAO.connect!(c, { grant: { id: "other", origins: ["not a site"] } }),
    );
    expect(typed?.code).toBe("INVALID_ARGS");
  });
  test("AppRole sign-in works, and a wrong secret id is refused (even right after a good sign-in)", async () => {
    resetOpenBaoState();
    const c = ctxOf({ baseUrl: base, ...approle });
    await OPENBAO.install!(c);
    expect((await browse(OPENBAO, c)).map((i) => i.id)).toEqual(["other", "web/github"]);
    expect(await reveal(OPENBAO, c, "other", "password")).toBe("p2");
    const wrong = ctxOf({
      baseUrl: base,
      roleId: approle.roleId,
      secretId: "00000000-0000-4000-8000-000000000000",
    });
    const e = await failure(OPENBAO.install!(wrong));
    expect(e?.code).toBe("AUTH");
    expect(`${e?.safe} ${e?.fix}`).not.toContain(approle.secretId);
  });
  test("a bad token is an AUTH error that never echoes the token", async () => {
    resetOpenBaoState();
    const e = await failure(OPENBAO.install!(ctxOf({ baseUrl: base, token: "bad-token-value" })));
    expect(e?.code).toBe("AUTH");
    expect(`${e?.safe} ${e?.fix}`).not.toContain("bad-token-value");
  });
  test("KV version 1 mounts, namespaces, and a folder prefix", async () => {
    resetOpenBaoState();
    const v1 = tokenCtx({ mount: "kv1" });
    expect((await browse(OPENBAO, v1)).map((i) => [i.id, i.urls])).toEqual([
      ["site1", ["https://v1.example.com"]],
    ]);
    expect(await reveal(OPENBAO, v1, "site1", "password")).toBe("v1pass");
    const ns = tokenCtx({ mount: "ns-kv", namespace: "team1" });
    expect((await browse(OPENBAO, ns)).map((i) => i.id)).toEqual(["app"]);
    expect(await reveal(OPENBAO, ns, "app", "username")).toBe("nsuser");
    const noNs = tokenCtx({ mount: "ns-kv" });
    expect(await browse(OPENBAO, noNs)).toEqual([]); // the mount lives in the namespace, not the root
    const folder = tokenCtx({ prefix: "web" });
    expect((await browse(OPENBAO, folder)).map((i) => i.id)).toEqual(["web/github"]);
    expect((await failure(reveal(OPENBAO, folder, "other", "password")))?.code).toBe(
      "ITEM_NOT_FOUND",
    );
  });
  test("the metadata-only listing of the bot tool", async () => {
    resetOpenBaoState();
    const cli = OPENBAO.tools!.find((t) => t.name === "cli")!;
    const c = tokenCtx({ cliAccess: "metadata" });
    const mounts = (await cli.handler(c, { command: "bao secrets list" } as never)) as {
      rows: { id: string }[];
    };
    expect(mounts.rows.map((r) => r.id)).toContain("secret/");
    const kv = JSON.stringify(await cli.handler(c, { command: "bao kv list" } as never));
    expect(kv).toContain("web/github");
    expect(kv).not.toContain("hunter2-test");
    expect(kv).not.toContain("octocat");
  });
});

describe.skipIf(!enabled || !hasBw)(
  "Bitwarden personal vault (real Vaultwarden through the real bw CLI)",
  () => {
    const port = freePort(),
      base = `https://localhost:${port}`;
    let dir: string, ca: string, key: { clientId: string; clientSecret: string };
    const saved = process.env.NODE_EXTRA_CA_CERTS;
    const bw = async (args: string[], env: Record<string, string>) => {
      const p = Bun.spawn(["bw", ...args], {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_EXTRA_CA_CERTS: join(dir, "cert.pem"),
          BW_NOINTERACTION: "true",
          BITWARDENCLI_APPDATA_DIR: join(dir, "seed"),
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [out, code] = [await new Response(p.stdout).text(), await p.exited];
      if (code !== 0) throw new Error(`bw ${args[0]} failed`);
      return out.trim();
    };
    const personal = (extra: Record<string, string> = {}, userId = "u-bw") =>
      ctxOf({ ...key, masterPassword: MASTER, serverUrl: base, ...extra }, userId);

    beforeAll(async () => {
      dir = await mkdtemp(join(process.env.ZETTA_VAULT_TEST_DIR ?? tmpdir(), "zetta-vw-"));
      const sh = async (cmd: string[]) => {
        const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
        if ((await p.exited) !== 0) throw new Error(`${cmd[0]} failed`);
      };
      await sh([
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ]);
      ca = await readFile(join(dir, "cert.pem"), "utf8");
      // create, copy the certificate in, then start: no bind mount, so it works where the engine's VM cannot see this folder
      await engine([
        "create",
        "--name",
        `${RUN}-vw`,
        "-p",
        `127.0.0.1:${port}:8443`,
        "-e",
        "I_REALLY_WANT_VOLATILE_STORAGE=true",
        "-e",
        "SIGNUPS_ALLOWED=true",
        "-e",
        `DOMAIN=${base}`,
        "-e",
        "ROCKET_PORT=8443",
        "-e",
        'ROCKET_TLS={certs="/ssl-cert.pem",key="/ssl-key.pem"}',
        "docker.io/vaultwarden/server:latest",
      ]);
      await engine(["cp", join(dir, "cert.pem"), `${RUN}-vw:/ssl-cert.pem`]);
      await engine(["cp", join(dir, "key.pem"), `${RUN}-vw:/ssl-key.pem`]);
      await engine(["start", `${RUN}-vw`]);
      await waitUntil(
        async () => (await fetch(`${base}/alive`, { tls: { ca } } as RequestInit)).ok,
        "Vaultwarden",
      );
      key = await registerVaultwarden(base, ca, EMAIL, MASTER);
      const seed = { BITWARDENCLI_APPDATA_DIR: join(dir, "seed") };
      await bw(["config", "server", base], seed);
      await bw(["login", "--apikey"], {
        ...seed,
        BW_CLIENTID: key.clientId,
        BW_CLIENTSECRET: key.clientSecret,
      });
      const session = await bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
        ...seed,
        BW_PASSWORD: MASTER,
      });
      const create = async (name: string, login: object) => {
        const tpl = JSON.parse(
          await bw(["get", "template", "item"], { ...seed, BW_SESSION: session }),
        );
        const encoded = Buffer.from(JSON.stringify({ ...tpl, type: 1, name, login })).toString(
          "base64",
        );
        await bw(["create", "item", encoded], { ...seed, BW_SESSION: session });
      };
      await create("GitHub Test", {
        username: "octocat",
        password: "hunter2-test",
        totp: SEED,
        uris: [{ match: null, uri: "https://github.com/login" }],
      });
      await create("No Totp", { username: "u2", password: "p2", uris: [] });
      process.env.NODE_EXTRA_CA_CERTS = join(dir, "cert.pem"); // what the server's administrator sets for a private CA
      configureVault({ allowPrivate: true, exec: spawnExec });
    }, 180_000);
    afterAll(async () => {
      if (saved === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = saved;
      await engine(["rm", "-f", `${RUN}-vw`], true);
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    test("signs in with the API key + master password, lists metadata only, reveals username, password and TOTP", async () => {
      resetBitwardenSessions();
      const c = personal();
      await BITWARDEN.install!(c);
      const items = await browse(BITWARDEN, c);
      expect(items.map((i) => [i.title, i.fields, i.urls])).toEqual([
        ["GitHub Test", ["username", "password", "totp"], ["https://github.com/login"]],
        ["No Totp", ["username", "password"], []],
      ]);
      expect(JSON.stringify(items)).not.toContain("hunter2-test");
      const gh = items.find((i) => i.title === "GitHub Test")!;
      expect(await reveal(BITWARDEN, c, gh.id, "username")).toBe("octocat");
      expect(await reveal(BITWARDEN, c, gh.id, "password")).toBe("hunter2-test");
      expect(codes()).toContain(await reveal(BITWARDEN, c, gh.id, "totp"));
      const cli = BITWARDEN.tools!.find((t) => t.name === "cli")!;
      const rows = JSON.stringify(
        await cli.handler(personal({ cliAccess: "metadata" }), {
          command: "bw list items",
        } as never),
      );
      expect(rows).toContain("GitHub Test");
      expect(rows).not.toContain("hunter2-test");
      await BITWARDEN.disconnect!(c);
    }, 120_000);
    test("a wrong master password and a wrong API secret are AUTH errors without the values", async () => {
      resetBitwardenSessions();
      const wrongPw = personal({ masterPassword: "Wrong-master-pw-9!" }, "u-bw-2");
      const e1 = await failure(BITWARDEN.install!(wrongPw));
      expect(e1?.code).toBe("AUTH");
      expect(`${e1?.safe} ${e1?.fix}`).not.toContain("Wrong-master-pw-9!");
      await BITWARDEN.disconnect!(wrongPw);
      const wrongKey = personal({ clientSecret: "not-the-secret" }, "u-bw-3");
      const e2 = await failure(BITWARDEN.install!(wrongKey));
      expect(e2?.code).toBe("AUTH");
      await BITWARDEN.disconnect!(wrongKey);
    }, 120_000);
    test("an http:// server address is refused with a clear message", async () => {
      const e = await failure(
        BITWARDEN.install!(personal({ serverUrl: base.replace("https", "http") }, "u-bw-4")),
      );
      expect(e?.code).toBe("INVALID_FIELD");
      expect(e?.safe).toContain("https://");
    });
    test("a field the item does not have is FIELD_EMPTY, not a leak", async () => {
      resetBitwardenSessions();
      const c = personal({}, "u-bw-5");
      const none = (await browse(BITWARDEN, c)).find((i) => i.title === "No Totp")!;
      const e = await failure(reveal(BITWARDEN, c, none.id, "totp"));
      expect(["FIELD_EMPTY", "ITEM_NOT_FOUND"]).toContain(e?.code ?? "");
      await BITWARDEN.disconnect!(c);
    }, 120_000);
  },
);
