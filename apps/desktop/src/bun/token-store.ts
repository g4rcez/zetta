import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Tokens } from "./oauth";
import type { SecretBox } from "./secret-box";

export type StoredLink = { tokens: Tokens; connectedAt: string };
/** The pairing of this computer with a remote server: whom the server knows it as, the credential it connects with, and whether it may. */
export type StoredDevice = { deviceId: string; credential: string; enabled: boolean };

/**
 * The tokens this app holds for the servers it signed in to, in one private file (mode 0600) in the app's data folder, keyed by the id of
 * the server entry. A file that cannot be read is moved aside, never overwritten, and everyone is simply signed out of the link.
 * Not in the system keychain yet: the file is as private as the person's own account on this computer.
 */
export function createTokenStore(
  file: string,
  now: () => Date = () => new Date(),
  box: SecretBox | null = null,
) {
  let links: Record<string, StoredLink> = {};
  let devices: Record<string, StoredDevice> = {};

  const isTokens = (value: unknown): value is Tokens => {
    const t = value as Tokens | null;
    return (
      typeof t === "object" &&
      t !== null &&
      typeof t.accessToken === "string" &&
      (t.refreshToken === null || typeof t.refreshToken === "string") &&
      typeof t.expiresAt === "number" &&
      typeof t.scope === "string"
    );
  };

  if (existsSync(file)) {
    try {
      let text = readFileSync(file, "utf8");
      const wrapper = JSON.parse(text) as { sealed?: unknown };
      // A sealed file is opened with the key from the vault; a plain one (an older version, or no vault) is read as it is.
      if (typeof wrapper.sealed === "string") {
        const opened = box?.open(wrapper.sealed);
        if (!opened) throw new Error("cannot open sealed file");
        text = opened;
      }
      const parsed = JSON.parse(text) as {
        links?: Record<string, unknown>;
        devices?: Record<string, unknown>;
      };
      if (!parsed.links || typeof parsed.links !== "object") throw new Error("no links");
      for (const [id, value] of Object.entries(parsed.links)) {
        const link = value as { tokens?: unknown; connectedAt?: unknown };
        if (isTokens(link?.tokens) && typeof link.connectedAt === "string")
          links[id] = { tokens: link.tokens, connectedAt: link.connectedAt };
      }
      for (const [id, value] of Object.entries(parsed.devices ?? {})) {
        const d = value as Partial<StoredDevice> | null;
        if (
          d &&
          typeof d.deviceId === "string" &&
          typeof d.credential === "string" &&
          typeof d.enabled === "boolean"
        )
          devices[id] = { deviceId: d.deviceId, credential: d.credential, enabled: d.enabled };
      }
    } catch {
      renameSync(file, `${file}.unreadable-${now().getTime()}`);
      links = {};
      devices = {};
    }
  }

  const save = () => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    const plain = JSON.stringify({ version: 1, links, devices }, null, 2);
    // With a key in the vault the file holds only ciphertext; anything else keeps the private plain file.
    const sealed = box?.seal(plain);
    writeFileSync(temp, `${sealed ? JSON.stringify({ version: 2, sealed }) : plain}\n`, {
      mode: 0o600,
    });
    renameSync(temp, file);
  };

  return {
    get: (id: string): StoredLink | undefined =>
      links[id] ? { ...links[id]!, tokens: { ...links[id]!.tokens } } : undefined,
    ids: (): string[] => Object.keys(links),
    set(id: string, tokens: Tokens): void {
      links[id] = { tokens, connectedAt: links[id]?.connectedAt ?? now().toISOString() };
      save();
    },
    remove(id: string): boolean {
      if (!links[id]) return false;
      delete links[id];
      delete devices[id];
      save();
      return true;
    },
    getDevice: (id: string): StoredDevice | undefined =>
      devices[id] ? { ...devices[id]! } : undefined,
    setDevice(id: string, device: StoredDevice): void {
      devices[id] = { ...device };
      save();
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
