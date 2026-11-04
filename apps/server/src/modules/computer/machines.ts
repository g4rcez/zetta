import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray, isNull, or } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { machine, machineBot } from "@zetta/db/schema/features";
import { audit } from "../features/audit";
import type { ConnectionsService } from "../connections/service";
import type { ActiveActor } from "../identity/access";
import {
  fingerprintOf,
  type ExecResult,
  type HostKeyCandidate,
  type MachineKind,
  type MachineRunner,
  type Op,
  type Target,
} from "./machine-runner";
import { createSerializer } from "./serial";
import { ComputerError, isBlockedIp } from "./service";

/**
 * Machines a user lets their bots reach (ssh, sftp, ftp). This row holds no secret: the key or password is a sealed `connection`
 * (provider "machine"), the same store and write-only rules as plugin secrets. The API never returns it.
 */
const SAFE_NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;
const SAFE_HOST = /^(?!-)[A-Za-z0-9._:-]{1,253}$/;
const SAFE_USER = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MACHINE_PROVIDER = "machine";
/** Largest private key accepted (RSA-4096 with comments is about 3.4 KiB). */
export const MAX_SECRET = 16_000;

type Row = typeof machine.$inferSelect;
export type MachineView = {
  id: string;
  name: string;
  kind: MachineKind;
  host: string;
  port: number;
  username: string;
  /** `SHA256:…` of the pinned host key (ssh, sftp). */
  fingerprint: string | null;
  hasSecret: true;
  /** The bots that may use this machine. None means no bot can. */
  botIds: string[];
  createdAt: string;
};
const view = (r: Row, botIds: string[] = []): MachineView => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  host: r.host,
  port: r.port,
  username: r.username,
  fingerprint: r.hostKey ? fingerprintOf(r.hostKey.split(" ")[1] ?? "") : null,
  hasSecret: true,
  botIds,
  createdAt: r.createdAt.toISOString(),
});

export type MachineDeps = {
  db: Database;
  connections: ConnectionsService;
  runner: MachineRunner;
  /** Same switch as the browser: private, loopback and link-local hosts stay blocked unless the operator allows them. */
  allowPrivate?: boolean;
  maxPerUser?: number;
  resolve?: (host: string) => Promise<string[]>;
};

export function createMachineService({
  db,
  connections,
  runner,
  allowPrivate = false,
  maxPerUser = 20,
  resolve = async (h) => (await lookup(h, { all: true })).map((a) => a.address),
}: MachineDeps) {
  const serial = createSerializer();
  const live = (userId: string) => and(eq(machine.ownerUserId, userId), isNull(machine.deletedAt));

  /** One lookup per call. The address that passes the check is the one the connection uses. */
  async function address(host: string): Promise<string> {
    if (!SAFE_HOST.test(host)) throw new ComputerError("INVALID");
    const h = host.toLowerCase();
    if (!allowPrivate && (h === "localhost" || /\.(localhost|local|internal)$/.test(h)))
      throw new ComputerError("BLOCKED_URL");
    const ips = isIP(h) ? [h] : await resolve(h).catch(() => []);
    if (!ips.length) throw new ComputerError("UNREACHABLE");
    if (!allowPrivate && ips.some(isBlockedIp)) throw new ComputerError("BLOCKED_URL");
    return ips[0]!;
  }

  async function owned(userId: string, ref: string): Promise<Row> {
    const [r] = await db
      .select()
      .from(machine)
      .where(and(live(userId), UUID.test(ref) ? eq(machine.id, ref) : eq(machine.name, ref)));
    if (!r) throw new ComputerError("NOT_FOUND");
    return r;
  }

  /** The bots the person may share a machine with: their own, and team bots they can use. Anything else is refused, not skipped. */
  async function pickBots(userId: string, ids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return [];
    const found = await db
      .select({ id: bot.id })
      .from(bot)
      .where(
        and(
          inArray(bot.id, wanted),
          eq(bot.archived, false),
          or(eq(bot.ownerUserId, userId), eq(bot.visibility, "team")),
        ),
      );
    if (found.length !== wanted.length) throw new ComputerError("INVALID");
    return wanted;
  }
  const grantsOf = async (rows: Row[]) => {
    const by = new Map<string, string[]>();
    if (!rows.length) return by;
    for (const g of await db
      .select()
      .from(machineBot)
      .where(
        inArray(
          machineBot.machineId,
          rows.map((r) => r.id),
        ),
      ))
      by.set(g.machineId, [...(by.get(g.machineId) ?? []), g.botId]);
    return by;
  };

  /** Reads the sealed secret for the length of one call. The Buffer is zeroed; a string cannot be, so it is never kept. */
  async function secretOf(a: ActiveActor, connectionId: string): Promise<string> {
    const buf = await connections.secretFor(a, connectionId).catch(() => undefined);
    if (!buf) throw new ComputerError("REVOKED");
    try {
      return buf.toString("utf8");
    } finally {
      buf.fill(0);
    }
  }

  const revokeQuietly = async (a: ActiveActor, id: string) => {
    try {
      const c = (await connections.list(a)).find((x) => x.id === id);
      if (c) await connections.revoke(a, id, c.revision);
    } catch {
      /* already revoked */
    }
  };

  /** A key that cannot be read (wrong format, passphrase) is refused here, not at the first bot call. */
  async function checkSecret(kind: MachineKind, secret: string): Promise<string | null> {
    if (kind === "ftp") {
      // oxlint-disable-next-line no-control-regex
      if (!secret || secret.length > 512 || /[\u0000-\u001f\u007f]/.test(secret))
        throw new ComputerError("INVALID");
      return null;
    }
    if (secret.length < 80 || secret.length > MAX_SECRET) throw new ComputerError("INVALID");
    return runner.publicKey(secret);
  }

  return {
    async list(userId: string): Promise<MachineView[]> {
      const rows = await db
        .select()
        .from(machine)
        .where(live(userId))
        .orderBy(asc(machine.createdAt));
      const grants = await grantsOf(rows);
      return rows.map((r) => view(r, grants.get(r.id)));
    },

    /** The host keys the machine offers, for the person to compare with what the administrator knows. */
    async scan(host: string, port: number): Promise<HostKeyCandidate[]> {
      return runner.scan(await address(host), port);
    },

    async create(
      a: ActiveActor,
      v: {
        name: string;
        kind: MachineKind;
        host: string;
        port: number;
        username: string;
        /** `<type> <base64>`, one of the keys `scan` returned. Required for ssh and sftp. */
        hostKey?: string;
        secret: string;
        /** The bots that may use it. Left out, no bot can until the person shares it. */
        botIds?: string[];
      },
    ): Promise<MachineView & { publicKey: string | null }> {
      if (!SAFE_NAME.test(v.name) || !SAFE_USER.test(v.username))
        throw new ComputerError("INVALID");
      return serial(a.userId, async () => {
        const botIds = await pickBots(a.userId, v.botIds ?? []);
        if (
          (await db.select({ id: machine.id }).from(machine).where(live(a.userId))).length >=
          maxPerUser
        )
          throw new ComputerError("LIMIT");
        const ip = await address(v.host);
        let hostKey: string | null = null;
        if (v.kind !== "ftp") {
          if (!v.hostKey) throw new ComputerError("INVALID");
          // The key the person confirmed must still be what the machine offers now.
          if (!(await runner.scan(ip, v.port)).some((k) => k.key === v.hostKey))
            throw new ComputerError("HOST_KEY_CHANGED");
          hostKey = v.hostKey;
        }
        const publicKey = await checkSecret(v.kind, v.secret);
        const id = uuidv7();
        const conn = await connections.create(a, {
          provider: MACHINE_PROVIDER,
          label: `machine:${id}`,
          secret: v.secret,
        });
        try {
          const [row] = await db
            .insert(machine)
            .values({
              id,
              ownerUserId: a.userId,
              name: v.name,
              kind: v.kind,
              host: v.host.toLowerCase(),
              port: v.port,
              username: v.username,
              hostKey,
              connectionId: conn.id,
            })
            .returning();
          if (botIds.length)
            await db
              .insert(machineBot)
              .values(botIds.map((botId) => ({ machineId: id, botId, ownerUserId: a.userId })));
          return { ...view(row!, botIds), publicKey };
        } catch (e) {
          await revokeQuietly(a, conn.id);
          // 23505 is a duplicate name for this user.
          throw (e as { cause?: { code?: string } }).cause?.code === "23505" ||
            (e as { code?: string }).code === "23505"
            ? new ComputerError("INVALID")
            : e;
        }
      });
    },

    /** Replaces the key or password. The old sealed secret is revoked after the new one is in place. */
    async setSecret(a: ActiveActor, ref: string, secret: string) {
      const m = await owned(a.userId, ref);
      const publicKey = await checkSecret(m.kind, secret);
      const conn = await connections.create(a, {
        provider: MACHINE_PROVIDER,
        label: `machine:${m.id}`,
        secret,
      });
      await db.update(machine).set({ connectionId: conn.id }).where(eq(machine.id, m.id));
      await revokeQuietly(a, m.connectionId);
      return {
        ...view({ ...m, connectionId: conn.id }, (await grantsOf([m])).get(m.id)),
        publicKey,
      };
    },

    /** Replaces the set of bots that may use the machine. An empty list takes it away from every bot. */
    async setBots(a: ActiveActor, ref: string, botIds: string[]): Promise<MachineView> {
      const m = await owned(a.userId, ref);
      const picked = await pickBots(a.userId, botIds);
      await db.transaction(async (tx) => {
        await tx.delete(machineBot).where(eq(machineBot.machineId, m.id));
        if (picked.length)
          await tx
            .insert(machineBot)
            .values(picked.map((botId) => ({ machineId: m.id, botId, ownerUserId: a.userId })));
      });
      return view(m, picked);
    },

    /** The public half of an ssh key, to add to the machine's `authorized_keys`. */
    async publicKey(a: ActiveActor, ref: string): Promise<string> {
      const m = await owned(a.userId, ref);
      if (m.kind === "ftp") throw new ComputerError("UNSUPPORTED");
      return runner.publicKey(await secretOf(a, m.connectionId));
    },

    async remove(a: ActiveActor, ref: string) {
      const m = await owned(a.userId, ref);
      await db.update(machine).set({ deletedAt: new Date() }).where(eq(machine.id, m.id));
      await db.delete(machineBot).where(eq(machineBot.machineId, m.id));
      await revokeQuietly(a, m.connectionId);
    },

    /** What one bot may use, by name: no secret, no host key. Only the machines shared with that bot. */
    async catalog(userId: string, botId: string) {
      return (
        await db
          .select({ r: machine })
          .from(machine)
          .innerJoin(machineBot, eq(machineBot.machineId, machine.id))
          .where(and(live(userId), eq(machineBot.botId, botId)))
          .orderBy(asc(machine.createdAt))
      ).map(({ r }) => ({ name: r.name, kind: r.kind, target: `${r.username}@${r.host}` }));
    },

    /**
     * One operation for a bot. The machine must be shared with that bot: any other name is NOT_FOUND, so a bot cannot tell which
     * machines exist. One call per machine at a time. The audit row records the action and the outcome, never the output.
     */
    async exec(
      a: ActiveActor,
      ref: string,
      op: Op,
      ctx: { botId: string; signal?: AbortSignal },
    ): Promise<ExecResult & { machine: string }> {
      const m = await owned(a.userId, ref);
      const detail = `machine:${op.type}`;
      const [grant] = await db
        .select({ botId: machineBot.botId })
        .from(machineBot)
        .where(and(eq(machineBot.machineId, m.id), eq(machineBot.botId, ctx.botId)));
      if (!grant) {
        await audit(db, a.userId, {
          kind: "tool_call",
          outcome: "denied",
          botId: ctx.botId,
          subjectId: m.id,
          detail,
        });
        throw new ComputerError("NOT_FOUND");
      }
      return serial(`machine:${m.id}`, async () => {
        try {
          const target: Target = {
            kind: m.kind,
            host: m.host,
            ip: await address(m.host),
            port: m.port,
            username: m.username,
            hostKey: m.hostKey,
          };
          const r = await runner.exec(target, await secretOf(a, m.connectionId), op, {
            signal: ctx.signal,
          });
          await audit(db, a.userId, {
            kind: "tool_call",
            outcome: r.exitCode === 0 ? "ok" : "failed",
            botId: ctx.botId,
            subjectId: m.id,
            detail,
          });
          return { ...r, machine: m.name };
        } catch (e) {
          const code = e instanceof ComputerError ? e.code : undefined;
          await audit(db, a.userId, {
            kind: "tool_call",
            outcome:
              code === "SLOW" ? "timeout" : code === "AUTH_FAILED" ? "auth_required" : "failed",
            botId: ctx.botId,
            subjectId: m.id,
            detail,
          });
          throw e;
        }
      });
    },
  };
}
export type MachineService = ReturnType<typeof createMachineService>;
