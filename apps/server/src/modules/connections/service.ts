import { randomUUID } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { botConnection } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import { audit } from "../features/audit";
import type { createConnectionStore } from "./store";
import { ConnectionStoreError } from "./store-contract";

type Store = Awaited<ReturnType<typeof createConnectionStore>>;
export class ConnectionRequiredError extends Error { constructor(readonly keys: string[]) { super("CONNECTION_REQUIRED"); } }
export class ConnectionsUnavailableError extends Error { constructor() { super("CONNECTIONS_UNAVAILABLE"); } }

/** Provider -> the environment variable its native CLI reads. Only the bound, active key of the requesting user is injected, per run. */
export const PROVIDER_ENV: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY" };
// jev, email and x have no CLI env var: their secrets are only used server-side (decision adapter, mailbox and X source readers).
export const PROVIDERS = [...Object.keys(PROVIDER_ENV), "jev", "email", "x"];

export function createConnectionsService(db: Database, store?: Store) {
  const need = () => { if (!store) throw new ConnectionsUnavailableError(); return store; };
  const visibleBot = async (a: ActiveActor, botId: string) => { const [b] = await db.select().from(bot).where(and(eq(bot.id, botId), eq(bot.archived, false))); if (!b || (b.ownerUserId !== a.userId && b.visibility !== "team")) throw new AccessError("NOT_FOUND"); return b; };
  return {
    configured: () => Boolean(store),
    providers: PROVIDERS,
    async list(a: ActiveActor) { return (await need().listOwned(a, { limit: 100 })).items; },
    /** The secret is held only as bytes long enough to seal it, then zeroed by the store. Responses never include it. */
    async create(a: ActiveActor, v: { provider: string; label: string; secret: string; expiresAt?: number | null }) {
      const c = await need().createApiKey(a, { operationId: randomUUID(), provider: v.provider, label: v.label, secret: new TextEncoder().encode(v.secret), expiresAt: v.expiresAt ?? null });
      await audit(db, a.userId, { kind: "connection", outcome: "ok", subjectId: c.id, detail: "created" });
      return c;
    },
    /** The actor's own active `jev` key (newest first), or a failure: never any other credential. */
    async jevSecret(a: ActiveActor) {
      const mine = (await need().listOwned(a, { limit: 100 })).items.filter((c) => c.provider === "jev" && c.state === "active").sort((x, y) => y.createdAt - x.createdAt)[0];
      if (!mine) throw new ConnectionStoreError("not-found");
      return need().resolveForExecution(a, mine.id);
    },
    /** Decrypted secret of one of the actor's own active connections, for server-side use only (caller zeroes the buffer). */
    secretFor: (a: ActiveActor, id: string) => need().resolveForExecution(a, id),
    async revoke(a: ActiveActor, id: string, expectedRevision: number) { const c = await need().revoke(a, { id, operationId: randomUUID(), expectedRevision }); await audit(db, a.userId, { kind: "connection", outcome: "ok", subjectId: id, detail: "revoked" }); return c; },
    /** Binds one of the actor's own active connections to a required key of a bot they can use. Other users' bindings are separate rows. */
    async bind(a: ActiveActor, botId: string, key: string, connectionId: string) {
      const b = await visibleBot(a, botId);
      const req = b.requiredConnections.find((r) => r.key === key);
      if (!req) throw new AccessError("NOT_FOUND");
      const mine = (await need().listOwned(a, { limit: 100 })).items.find((c) => c.id === connectionId && c.state === "active");
      if (!mine || mine.provider !== req.provider) throw new AccessError("NOT_FOUND");
      await db.insert(botConnection).values({ botId, ownerUserId: a.userId, key, connectionId }).onConflictDoUpdate({ target: [botConnection.botId, botConnection.ownerUserId, botConnection.key], set: { connectionId } });
      return { botId, key, connectionId };
    },
    async unbind(a: ActiveActor, botId: string, key: string) { await db.delete(botConnection).where(and(eq(botConnection.botId, botId), eq(botConnection.ownerUserId, a.userId), eq(botConnection.key, key))); return { botId, key }; },
    /** Per-user status for a bot's required connections: bound+active, bound but unusable (revoked/expired), or missing. */
    async status(a: ActiveActor, botId: string) {
      const b = await visibleBot(a, botId);
      const bindings = await db.select().from(botConnection).where(and(eq(botConnection.botId, botId), eq(botConnection.ownerUserId, a.userId)));
      const mine = store ? (await store.listOwned(a, { limit: 100 })).items : [];
      return b.requiredConnections.map((r) => {
        const bound = bindings.find((x) => x.key === r.key); const c = bound && mine.find((m) => m.id === bound.connectionId);
        return { key: r.key, provider: r.provider, status: !bound ? "missing" as const : c && c.state === "active" ? "ready" as const : "unusable" as const };
      });
    },
    /**
     * Environment variables for one run of `b` by the requesting user. Fails closed: a missing, revoked, expired or foreign
     * binding raises ConnectionRequiredError and never falls back to any other credential. Returns the env and a disposer.
     */
    async envFor(a: ActiveActor, b: { id: string; requiredConnections: { key: string; provider: string }[] }) {
      if (!b.requiredConnections.length) return { env: {} as Record<string, string>, dispose() {} };
      if (!store) throw new ConnectionRequiredError(b.requiredConnections.map((r) => r.key));
      const bindings = await db.select().from(botConnection).where(and(eq(botConnection.botId, b.id), eq(botConnection.ownerUserId, a.userId)));
      const env: Record<string, string> = {}; const buffers: Buffer[] = []; const missing: string[] = [];
      for (const r of b.requiredConnections) {
        const bound = bindings.find((x) => x.key === r.key);
        try {
          if (!bound || !PROVIDER_ENV[r.provider]) throw new ConnectionStoreError("not-found");
          const secret = await store.resolveForExecution(a, bound.connectionId); buffers.push(secret);
          env[PROVIDER_ENV[r.provider]!] = secret.toString("utf8");
        } catch { missing.push(r.key); }
      }
      if (missing.length) { buffers.forEach((x) => x.fill(0)); throw new ConnectionRequiredError(missing); }
      return { env, dispose() { buffers.forEach((x) => x.fill(0)); } };
    },
  };
}
export type ConnectionsService = ReturnType<typeof createConnectionsService>;
