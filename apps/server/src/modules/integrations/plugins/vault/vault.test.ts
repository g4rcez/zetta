import { beforeEach, describe, expect, test } from "bun:test";
import { PluginError, type PluginContext } from "../registry";
import { actor, world } from "../test-world";
import { BITWARDEN, resetBitwardenSessions } from "./bitwarden";
import { configureVault, type VaultExec } from "./exec";
import { ONEPASSWORD } from "./onepassword";

/** A fake CLI: records argv + env and answers from a handler. Secrets must only ever show up in env. */
const calls: { argv: string[]; env: Record<string, string> }[] = [];
let answer: (
  argv: string[],
  env: Record<string, string>,
) => { code?: number; stdout?: string; stderr?: string } = () => ({ stdout: "[]" });
const fakeExec: VaultExec = async (argv, env) => {
  calls.push({ argv, env });
  const r = answer(argv, env);
  return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const ctx = (
  config: Record<string, string>,
  userId = "u1",
): PluginContext & { saved: Record<string, string>[] } => {
  const saved: Record<string, string>[] = [];
  let cfg = { ...config };
  return {
    userId,
    get config() {
      return cfg;
    },
    async setConfig(next: Record<string, string>) {
      cfg = { ...next };
      saved.push(next);
    },
    saved,
  } as never;
};
const SA = "ops_SECRET_TOKEN_123";
const opItems = [
  {
    id: "itm1",
    title: "GitHub",
    category: "LOGIN",
    vault: { id: "vlt1" },
    urls: [{ href: "https://github.com/login" }],
  },
  { id: "itm2", title: "Wifi", category: "PASSWORD", vault: { id: "vlt1" } },
];
const op: typeof answer = (argv) => {
  if (argv[1] === "vault") return { stdout: "[]" };
  if (argv[1] === "item" && argv[2] === "list") return { stdout: JSON.stringify(opItems) };
  if (argv.includes("--otp")) return { stdout: "123456\n" };
  if (argv[1] === "item" && argv[2] === "get")
    return {
      stdout: JSON.stringify({
        fields: [
          { purpose: "USERNAME", value: "octocat" },
          { purpose: "PASSWORD", value: "hunter2" },
        ],
      }),
    };
  return { code: 1, stderr: "unknown" };
};
beforeEach(() => {
  calls.length = 0;
  answer = () => ({ stdout: "[]" });
  resetBitwardenSessions();
  configureVault({ exec: fakeExec, allowPrivate: true });
});

describe("1Password", () => {
  test("service account: lists Login/Password items as metadata, reveals one field, token only in env", async () => {
    answer = op;
    const c = ctx({ serviceAccountToken: SA });
    await ONEPASSWORD.install!(c);
    const browse = (await ONEPASSWORD.connect!(c, { browse: {} }))!.data!.items as {
      id: string;
      fields: string[];
    }[];
    expect(browse.map((i) => [i.id, i.fields])).toEqual([
      ["vlt1/itm1", ["username", "password", "totp"]],
      ["vlt1/itm2", ["password"]],
    ]);
    expect(JSON.stringify(browse)).not.toContain("hunter2");
    expect(await ONEPASSWORD.credentials!.reveal(c, "vlt1/itm1", "password")).toBe("hunter2");
    expect(await ONEPASSWORD.credentials!.reveal(c, "vlt1/itm1", "username")).toBe("octocat");
    expect(await ONEPASSWORD.credentials!.reveal(c, "vlt1/itm1", "totp")).toBe("123456");
    for (const x of calls) {
      expect(x.argv.join(" ")).not.toContain(SA);
      expect(x.env.OP_SERVICE_ACCOUNT_TOKEN).toBe(SA);
      expect(x.argv[0]).toBe("op");
    }
    expect(calls.find((x) => x.argv.includes("--otp"))!.argv).toEqual([
      "op",
      "item",
      "get",
      "itm1",
      "--vault",
      "vlt1",
      "--otp",
    ]);
  });
  test("errors never echo CLI output, and a bad id never reaches argv", async () => {
    answer = () => ({ code: 1, stderr: `[ERROR] authentication failed for token ${SA}` });
    const c = ctx({ serviceAccountToken: SA });
    const e = (await ONEPASSWORD.install!(c).catch((x) => x)) as PluginError;
    expect(e).toBeInstanceOf(PluginError);
    expect(e.code).toBe("AUTH");
    expect(`${e.safe} ${e.fix}`).not.toContain(SA);
    calls.length = 0;
    await expect(ONEPASSWORD.credentials!.reveal(c, "--vault=x/y", "password")).rejects.toThrow(
      "INVALID_ARGS",
    );
    expect(calls).toHaveLength(0);
  });
  test("a missing CLI is a clear error", async () => {
    configureVault({
      exec: async () => {
        throw Object.assign(new Error("x"), { code: "ENOENT" });
      },
    });
    const e = (await ONEPASSWORD.install!(ctx({ serviceAccountToken: SA })).catch(
      (x) => x,
    )) as PluginError;
    expect(e.code).toBe("CLI_MISSING");
  });
  test("exactly one connection style", async () => {
    await expect(ONEPASSWORD.install!(ctx({}))).rejects.toThrow("MISSING_FIELD");
    await expect(
      ONEPASSWORD.install!(
        ctx({ serviceAccountToken: SA, connectUrl: "https://op.example.com", connectToken: "t" }),
      ),
    ).rejects.toThrow("INVALID_FIELD");
    await expect(
      ONEPASSWORD.install!(ctx({ connectUrl: "https://op.example.com" })),
    ).rejects.toThrow("MISSING_FIELD");
  });
  test("Connect server: bearer token header, items from every vault, TOTP computed from a seed", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    configureVault({
      fetch: (async (u: string, init: RequestInit) => {
        seen.push({ url: u, auth: new Headers(init.headers).get("authorization") });
        const body = u.endsWith("/v1/vaults")
          ? [{ id: "v1" }]
          : u.endsWith("/v1/vaults/v1/items")
            ? [
                {
                  id: "i1",
                  title: "Site",
                  category: "LOGIN",
                  urls: [{ href: "https://site.example" }],
                },
                { id: "i2", title: "Note", category: "SECURE_NOTE" },
              ]
            : {
                fields: [
                  { purpose: "PASSWORD", value: "pw" },
                  {
                    type: "OTP",
                    value: "otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                  },
                ],
              };
        return new Response(JSON.stringify(body));
      }) as never,
    });
    const c = ctx({ connectUrl: "https://op.example.com/", connectToken: "conn-tok" });
    const items = (await ONEPASSWORD.connect!(c, { browse: {} }))!.data!.items as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["v1/i1"]);
    expect(await ONEPASSWORD.credentials!.reveal(c, "v1/i1", "password")).toBe("pw");
    expect(await ONEPASSWORD.credentials!.reveal(c, "v1/i1", "totp")).toMatch(/^\d{6}$/);
    expect(seen.every((s) => s.auth === "Bearer conn-tok" && !s.url.includes("conn-tok"))).toBe(
      true,
    );
  });
});

describe("Bitwarden", () => {
  test("personal vault: logs in with the API key, unlocks by env, session by env, never secrets in argv", async () => {
    let status = "unauthenticated";
    answer = (argv, env) => {
      const cmd = argv[1];
      if (cmd === "status") return { stdout: JSON.stringify({ status }) };
      if (cmd === "config" || cmd === "sync") return {};
      if (cmd === "login") {
        status = "locked";
        return env.BW_CLIENTID === "user.abc" && env.BW_CLIENTSECRET === "cs"
          ? {}
          : { code: 1, stderr: "invalid_client" };
      }
      if (cmd === "unlock")
        return env.BW_PASSWORD === "master pw"
          ? { stdout: "SESSIONKEY" }
          : { code: 1, stderr: "Invalid master password." };
      if (env.BW_SESSION !== "SESSIONKEY") return { code: 1, stderr: "Vault is locked." };
      if (cmd === "list")
        return {
          stdout: JSON.stringify([
            {
              id: "b1",
              name: "Bank",
              type: 1,
              login: {
                username: "me",
                password: "p@ss",
                totp: null,
                uris: [{ uri: "https://bank.example/login" }],
              },
            },
            { id: "n1", name: "Note", type: 2 },
          ]),
        };
      if (cmd === "get") return { stdout: argv[2] === "password" ? "p@ss" : "me" };
      return { code: 1 };
    };
    const c = ctx({
      clientId: "user.abc",
      clientSecret: "cs",
      masterPassword: "master pw",
      serverUrl: "https://vault.example.com",
    });
    await BITWARDEN.install!(c);
    const items = (await BITWARDEN.connect!(c, { browse: {} }))!.data!.items as {
      id: string;
      fields: string[];
      urls: string[];
    }[];
    expect(items).toEqual([
      expect.objectContaining({
        id: "b1",
        fields: ["username", "password"],
        urls: ["https://bank.example/login"],
      }),
    ]);
    expect(await BITWARDEN.credentials!.reveal(c, "b1", "password")).toBe("p@ss");
    expect(calls.find((x) => x.argv[1] === "config")!.argv).toEqual([
      "bw",
      "config",
      "server",
      "https://vault.example.com",
    ]);
    for (const x of calls)
      for (const secret of ["cs", "master pw", "SESSIONKEY", "p@ss"])
        expect(x.argv).not.toContain(secret);
    expect(calls.filter((x) => x.argv[1] === "unlock")).toHaveLength(1); // the session is reused
  });
  test("a server address on the private network is blocked before the CLI runs", async () => {
    configureVault({ allowPrivate: false });
    const e = (await BITWARDEN.install!(
      ctx({
        clientId: "user.abc",
        clientSecret: "cs",
        masterPassword: "pw",
        serverUrl: "http://127.0.0.1:8080",
      }),
    ).catch((x) => x)) as PluginError;
    expect(e.code).toBe("BLOCKED_URL");
    expect(calls).toHaveLength(0);
  });
  test("a wrong master password is AUTH and clears the session", async () => {
    answer = (argv) =>
      argv[1] === "status"
        ? { stdout: '{"status":"locked"}' }
        : { code: 1, stderr: "Invalid master password." };
    const e = (await BITWARDEN.install!(
      ctx({ clientId: "user.abc", clientSecret: "cs", masterPassword: "nope" }),
    ).catch((x) => x)) as PluginError;
    expect(e.code).toBe("AUTH");
  });
  test("Secrets Manager: secrets are offered as passwords, values dropped from listings", async () => {
    answer = (argv, env) => {
      expect(env.BWS_ACCESS_TOKEN).toBe("0.tok");
      if (argv[1] === "secret" && argv[2] === "list")
        return { stdout: JSON.stringify([{ id: "s-1", key: "STRIPE_LOGIN", value: "sekrit" }]) };
      if (argv[1] === "secret" && argv[2] === "get")
        return { stdout: JSON.stringify({ id: "s-1", value: "sekrit" }) };
      return { stdout: "[]" };
    };
    const c = ctx({ accessToken: "0.tok" });
    const items = (await BITWARDEN.connect!(c, { browse: {} }))!.data!.items;
    expect(JSON.stringify(items)).not.toContain("sekrit");
    // no website is stored with a secret: sharing it needs explicit sites
    await expect(BITWARDEN.connect!(c, { grant: { id: "s-1" } })).rejects.toThrow("NO_ORIGINS");
    await BITWARDEN.connect!(c, { grant: { id: "s-1", origins: ["dashboard.stripe.com"] } });
    expect(await BITWARDEN.credentials!.grants(c)).toEqual([
      { id: "s-1", title: "STRIPE_LOGIN", origins: ["dashboard.stripe.com"], fields: ["password"] },
    ]);
    expect(await BITWARDEN.credentials!.reveal(c, "s-1", "password")).toBe("sekrit");
  });
});

describe("grants and the credential gate", () => {
  test("grant takes title and sites from the vault, validates fields, revoke removes it", async () => {
    answer = op;
    const c = ctx({ serviceAccountToken: SA });
    await ONEPASSWORD.connect!(c, { grant: { id: "vlt1/itm1", title: "spoofed" } });
    expect(await ONEPASSWORD.credentials!.grants(c)).toEqual([
      {
        id: "vlt1/itm1",
        title: "GitHub",
        origins: ["github.com"],
        fields: ["username", "password"],
      },
    ]);
    await expect(
      ONEPASSWORD.connect!(c, {
        grant: { id: "vlt1/itm2", fields: ["username"], origins: ["router.example"] },
      }),
    ).rejects.toThrow("INVALID_ARGS");
    await expect(ONEPASSWORD.connect!(c, { grant: { id: "vlt1/nope" } })).rejects.toThrow(
      "ITEM_NOT_FOUND",
    );
    await expect(
      ONEPASSWORD.connect!(c, { grant: { id: "vlt1/itm1", origins: ["127.0.0.1"] } }),
    ).rejects.toThrow("INVALID_ARGS");
    const listed = JSON.parse(JSON.stringify(await ONEPASSWORD.tools![0]!.handler(c, {})));
    expect(listed.credentials).toEqual([
      {
        ref: "1password:vlt1/itm1",
        title: "GitHub",
        sites: ["github.com"],
        fields: ["username", "password"],
      },
    ]);
    await ONEPASSWORD.connect!(c, { revoke: { id: "vlt1/itm1" } });
    expect(await ONEPASSWORD.credentials!.grants(c)).toEqual([]);
  });
  test("plugins.credential: binding, grant, field and origin are all enforced before anything is revealed", async () => {
    answer = op;
    const { plugins } = world();
    const a = actor("alice");
    await plugins.install(a, "1password", { serviceAccountToken: SA }, ["bot1"]);
    await plugins.connect(a, "1password", { grant: { id: "vlt1/itm1" } });
    const reveals = () => calls.filter((x) => x.argv[2] === "get").length;
    const before = reveals();
    await expect(
      plugins.credential(
        a,
        "bot2",
        "1password",
        "vlt1/itm1",
        "password",
        "https://github.com/login",
      ),
    ).rejects.toThrow("NOT_BOUND");
    await expect(
      plugins.credential(
        a,
        "bot1",
        "1password",
        "vlt1/itm2",
        "password",
        "https://github.com/login",
      ),
    ).rejects.toThrow("NOT_GRANTED");
    await expect(
      plugins.credential(a, "bot1", "1password", "vlt1/itm1", "totp", "https://github.com/login"),
    ).rejects.toThrow("FIELD_NOT_GRANTED");
    await expect(
      plugins.credential(
        a,
        "bot1",
        "1password",
        "vlt1/itm1",
        "password",
        "https://github.com.evil.io/login",
      ),
    ).rejects.toThrow("ORIGIN_MISMATCH");
    await expect(
      plugins.credential(
        a,
        "bot1",
        "1password",
        "vlt1/itm1",
        "password",
        "http://github.com/login",
      ),
    ).rejects.toThrow("ORIGIN_MISMATCH");
    expect(reveals()).toBe(before);
    expect(
      await plugins.credential(
        a,
        "bot1",
        "1password",
        "vlt1/itm1",
        "password",
        "https://github.com/login",
      ),
    ).toEqual({ value: "hunter2", title: "GitHub" });
    // another user cannot use alice's install or grants
    await expect(
      plugins.credential(
        actor("bob"),
        "bot1",
        "1password",
        "vlt1/itm1",
        "password",
        "https://github.com/login",
      ),
    ).rejects.toThrow("NOT_BOUND");
    expect((await plugins.credentialGrants(a, "bot1")).map((g) => g.grant.id)).toEqual([
      "vlt1/itm1",
    ]);
    expect(await plugins.promptFor(a, "bot1")).toContain("zetta:credential");
    expect(await plugins.promptFor(a, "bot1")).not.toContain("hunter2");
  });
});
