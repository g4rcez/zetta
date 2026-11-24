import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { connection } from "@zetta/db/schema/connections";
import { Elysia } from "elysia";
import { createIdentityAccess } from "../identity/access";
import type { GoogleMailAccess } from "../integrations/plugins/google/mail-access";
import type { MicrosoftMailAccess } from "../integrations/plugins/microsoft/mail-access";
import type { MailChatService } from "./chat";
import { createMailRoutes, type MailServices } from "./routes";
import { createMailService, type DriverFactory, type MailSecrets } from "./service";
import { createMailboxStore } from "./store";
import type { DnsResolver } from "./providers";

export const ORIGIN = "https://app.example.invalid";

/**
 * Test support for the mailbox routes: the real routes, service and store over a real database, with the sealed-password store in memory
 * (a real `connection` row per secret, because the mailbox points at it) and a keyring that "opens" the plain payload. The mail driver
 * is whatever the caller passes. Nothing here opens a network connection.
 */
export function createMailHarness(
  db: Database,
  o: {
    driverFor?: DriverFactory;
    dns?: DnsResolver;
    closeConnection?: (id: string) => Promise<void>;
    chat?: MailChatService;
    /** The person's Google connection; without it no Google account is a mailbox. */
    google?: GoogleMailAccess;
    /** The person's Microsoft connection; without it no Microsoft account is a mailbox. */
    microsoft?: MicrosoftMailAccess;
  } = {},
) {
  const secrets = new Map<string, string>();
  const handedOut: Buffer[] = [];
  const revoked: string[] = [];
  const closed: string[] = [];
  const opened: { userId: string; purpose: string }[] = [];

  const store: MailSecrets = {
    async create(a, v) {
      const id = uuidv7();
      const now = new Date();
      await db.insert(connection).values({
        id,
        ownerUserId: a.userId,
        kind: "api-key",
        provider: v.provider,
        label: v.label,
        state: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        currentCredentialVersion: 1,
      });
      secrets.set(id, v.secret);
      return { id };
    },
    list: async () => [...secrets.keys()].map((id) => ({ id, revision: 1 })),
    async revoke(_a, id) {
      revoked.push(id);
      secrets.delete(id);
    },
    async secretFor(_a, id) {
      const s = secrets.get(id);
      if (s === undefined) throw new Error("gone");
      const b = Buffer.from(s);
      handedOut.push(b);
      return b;
    },
  };
  const mail = createMailService({
    store: createMailboxStore(db),
    secrets: store,
    ...(o.driverFor ? { driverFor: o.driverFor } : {}),
    ...(o.google ? { google: o.google } : {}),
    ...(o.microsoft ? { microsoft: o.microsoft } : {}),
    closeConnection: async (id) => {
      closed.push(id);
      await o.closeConnection?.(id);
    },
  });
  const access = createIdentityAccess(
    {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get("cookie");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const keyring = {
    publicKey: async () => ({}),
    // "Sealed" is the plain payload here; what the real keyring checks (user and purpose) is recorded.
    open: async (sealed: unknown, ctx: { userId: string; purpose: string }) => {
      opened.push(ctx);
      return sealed;
    },
  } as never;
  const services: MailServices = {
    access,
    mail,
    ...(o.chat ? { chat: o.chat } : {}),
    ...(o.dns ? { dns: o.dns } : {}),
  };
  const app = () => new Elysia().use(createMailRoutes(services, [ORIGIN], keyring));
  let current = app();
  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const r = await current.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          ...(as ? { cookie: as } : {}),
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    return {
      status: r.status,
      headers: r.headers,
      bytes,
      text: new TextDecoder().decode(bytes),
      json: (await r.json().catch(() => ({}))) as any,
    };
  };
  return {
    call,
    secrets,
    handedOut,
    revoked,
    closed,
    opened,
    mail,
    store: createMailboxStore(db),
    resetRoutes: () => void (current = app()),
  };
}
