import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Where one small secret (the key that seals the token file) is kept outside the app's data folder. */
export type KeyVault = { get(): string | null; set(value: string): boolean };

const SERVICE = "app.zettabot.desktop";
const ACCOUNT = "token-file-key";

/** The macOS Keychain, through its own `security` tool. Null on any failure: the caller then keeps the 0600 file as it was. */
export function macKeychain(
  run: (args: string[]) => { code: number; out: string } = defaultRun,
): KeyVault {
  return {
    get() {
      const r = run(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      return r.code === 0 && r.out.trim() ? r.out.trim() : null;
    },
    set(value) {
      return (
        run(["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", value]).code === 0
      );
    },
  };
}

function defaultRun(args: string[]) {
  try {
    const r = Bun.spawnSync(["/usr/bin/security", ...args], { stdout: "pipe", stderr: "ignore" });
    return { code: r.exitCode, out: r.stdout.toString() };
  } catch {
    return { code: 1, out: "" };
  }
}

/** AES-256-GCM with a key that lives in the vault. Without a vault (or when it fails) `seal` is not offered and files stay plain. */
export function createSecretBox(vault: KeyVault | null) {
  let key: Buffer | null = null;
  const load = (create: boolean): Buffer | null => {
    if (key) return key;
    const stored = vault?.get();
    if (stored) return (key = Buffer.from(stored, "base64"));
    if (!create || !vault) return null;
    const made = randomBytes(32);
    return vault.set(made.toString("base64")) ? (key = made) : null;
  };
  return {
    /** True when a key is (or can be) kept in the vault. */
    available: () => load(true) !== null,
    seal(plain: string): string | null {
      const k = load(true);
      if (!k) return null;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", k, iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    /** The text, or null when the key is missing or the data was changed. */
    open(sealed: string): string | null {
      const k = load(false);
      if (!k) return null;
      try {
        const raw = Buffer.from(sealed, "base64");
        const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
          "utf8",
        );
      } catch {
        return null;
      }
    },
  };
}
export type SecretBox = ReturnType<typeof createSecretBox>;
