import {
  createCipheriv,
  createHmac,
  generateKeyPairSync,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";

/**
 * Helpers for `vault-real.test.ts`: containers through the engine's CLI, and a throwaway Vaultwarden account made without a browser.
 * Everything here talks to servers the test starts itself on localhost; nothing reaches a hosted service.
 */
export const ENGINE = process.env.ZETTA_DOCKER_BIN || "docker";

export async function engine(args: string[], allowFail = false) {
  const p = Bun.spawn([ENGINE, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0 && !allowFail)
    throw new Error(`${ENGINE} ${args[0]} failed: ${err.slice(0, 300)}`);
  return out.trim();
}

/** A random high port that is free right now. */
export function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port!;
  void s.stop(true);
  return port;
}

export async function waitUntil(check: () => Promise<boolean>, what: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(500);
  }
  throw new Error(`${what} did not come up in ${ms / 1000}s`);
}

/** Registers an account on a Vaultwarden server the way the web vault does (PBKDF2 master key, HKDF stretch, AES-CBC + HMAC "EncString"), then returns its API key. */
export async function registerVaultwarden(
  base: string,
  ca: string,
  email: string,
  password: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const ITER = 600_000;
  const masterKey = pbkdf2Sync(password, email.toLowerCase(), ITER, 32, "sha256");
  const hash = pbkdf2Sync(masterKey, password, 1, 32, "sha256").toString("base64");
  const expand = (info: string) =>
    createHmac("sha256", masterKey)
      .update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
      .digest();
  const encString = (data: Buffer, ek: Buffer, mk: Buffer) => {
    const iv = randomBytes(16),
      c = createCipheriv("aes-256-cbc", ek, iv),
      ct = Buffer.concat([c.update(data), c.final()]),
      mac = createHmac("sha256", mk)
        .update(Buffer.concat([iv, ct]))
        .digest();
    return `2.${iv.toString("base64")}|${ct.toString("base64")}|${mac.toString("base64")}`;
  };
  const userKey = randomBytes(64);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const post = async (path: string, init: RequestInit) => {
    const r = await fetch(base + path, { ...init, tls: { ca } } as RequestInit);
    const t = await r.text();
    if (!r.ok) throw new Error(`${path} answered ${r.status}`);
    try {
      return t ? JSON.parse(t) : {};
    } catch {
      return t.replace(/^"|"$/g, ""); // the verification token is a bare string
    }
  };
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const emailVerificationToken = await post(
    "/identity/accounts/register/send-verification-email",
    json({ email, name: "Zetta Test", receiveMarketingEmails: false }),
  );
  await post(
    "/identity/accounts/register/finish",
    json({
      email,
      emailVerificationToken,
      masterPasswordHash: hash,
      masterPasswordHint: null,
      userSymmetricKey: encString(userKey, expand("enc"), expand("mac")),
      userAsymmetricKeys: {
        publicKey: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64"),
        encryptedPrivateKey: encString(
          privateKey.export({ type: "pkcs8", format: "der" }) as Buffer,
          userKey.subarray(0, 32),
          userKey.subarray(32),
        ),
      },
      kdf: 0,
      kdfIterations: ITER,
    }),
  );
  const tok = await post("/identity/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: email,
      password: hash,
      scope: "api offline_access",
      client_id: "web",
      deviceType: "9",
      deviceIdentifier: "00000000-0000-4000-8000-000000000001",
      deviceName: "zetta-test",
    }),
  });
  const auth = { authorization: `Bearer ${tok.access_token}` };
  const key = await post("/api/accounts/api-key", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ masterPasswordHash: hash, otp: null }),
  });
  const profile = (await (
    await fetch(base + "/api/accounts/profile", { headers: auth, tls: { ca } } as RequestInit)
  ).json()) as { id: string };
  return { clientId: `user.${profile.id}`, clientSecret: key.apiKey };
}
