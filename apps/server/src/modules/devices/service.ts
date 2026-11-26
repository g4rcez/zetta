import { createHash, randomBytes } from "node:crypto";
import { tenant } from "@zetta/db";
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray, isNull, or } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { device, deviceBot } from "@zetta/db/schema/devices";
import { audit } from "../features/audit";
import type { ExecResult, Op } from "../computer/machine-runner";
import { ComputerError } from "../computer/service";
import type { ActiveActor } from "../identity/access";
import type { DeviceHub } from "./hub";

export const DEVICE_PLATFORMS = ["darwin", "linux", "win32"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];
const SAFE_NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;
const CREDENTIAL_PREFIX = "zdv_";
const MAX_OUTPUT = 64 * 1024;

type Row = typeof device.$inferSelect;
export type DeviceView = {
  id: string;
  name: string;
  platform: DevicePlatform;
  online: boolean;
  lastSeenAt: string | null;
  botIds: string[];
  createdAt: string;
};

const hashOf = (credential: string) => createHash("sha256").update(credential).digest("hex");

export function createDeviceService(deps: { db: Database; hub: DeviceHub; maxPerUser?: number }) {
  const { db, hub, maxPerUser = 10 } = deps;
  const live = (userId: string) => and(eq(device.ownerUserId, userId), isNull(device.revokedAt));

  const view = (row: Row, botIds: string[]): DeviceView => ({
    id: row.id,
    name: row.name,
    platform: row.platform as DevicePlatform,
    online: hub.online(row.id),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    botIds,
    createdAt: row.createdAt.toISOString(),
  });

  async function grantsOf(ids: string[]): Promise<Map<string, string[]>> {
    const by = new Map<string, string[]>();
    if (!ids.length) return by;
    for (const g of await db.select().from(deviceBot).where(inArray(deviceBot.deviceId, ids)))
      by.set(g.deviceId, [...(by.get(g.deviceId) ?? []), g.botId]);
    return by;
  }

  /** The device the person means by id or by name; a revoked one does not exist. */
  async function owned(userId: string, ref: string): Promise<Row> {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const [row] = await db
      .select()
      .from(device)
      .where(and(live(userId), isId ? eq(device.id, ref) : eq(device.name, ref)));
    if (!row) throw new ComputerError("NOT_FOUND");
    return row;
  }

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

  return {
    /**
     * Pairs a computer. The credential is returned once and only its hash is kept. A computer with the same name replaces the old pairing
     * (the app was reinstalled): the old credential stops working.
     */
    async create(
      a: ActiveActor,
      input: { name: string; platform: string },
    ): Promise<{ device: DeviceView; credential: string }> {
      if (
        !SAFE_NAME.test(input.name) ||
        !(DEVICE_PLATFORMS as readonly string[]).includes(input.platform)
      )
        throw new ComputerError("INVALID");
      const credential = `${CREDENTIAL_PREFIX}${randomBytes(32).toString("base64url")}`;
      const same = (
        await db
          .select()
          .from(device)
          .where(and(live(a.userId), eq(device.name, input.name)))
      )[0];
      if (same) {
        await db
          .update(device)
          .set({ credentialHash: hashOf(credential), platform: input.platform, lastSeenAt: null })
          .where(eq(device.id, same.id));
        hub.drop(same.id);
        const row = (await db.select().from(device).where(eq(device.id, same.id)))[0]!;
        return { device: view(row, (await grantsOf([row.id])).get(row.id) ?? []), credential };
      }
      if (
        (await db.select({ id: device.id }).from(device).where(live(a.userId))).length >= maxPerUser
      )
        throw new ComputerError("LIMIT");
      const [row] = await db
        .insert(device)
        .values({
          id: uuidv7(),
          ownerUserId: a.userId,
          name: input.name,
          platform: input.platform,
          credentialHash: hashOf(credential),
        })
        .returning();
      await audit(db, a.userId, {
        kind: "connection",
        outcome: "ok",
        subjectId: row!.id,
        detail: "device:paired",
      });
      return { device: view(row!, []), credential };
    },

    /** Who a credential belongs to, or null (wrong, or revoked). The only way a device proves itself. */
    async authenticate(
      credential: string,
    ): Promise<{ id: string; ownerUserId: string; name: string; workspaceId: string } | null> {
      if (!credential.startsWith(CREDENTIAL_PREFIX) || credential.length > 100) return null;
      // A device names no workspace: it is found by its credential across them, and its request then works in the device's own.
      const [row] = await tenant.scan(() =>
        db
          .select()
          .from(device)
          .where(and(eq(device.credentialHash, hashOf(credential)), isNull(device.revokedAt))),
      );
      if (!row) return null;
      tenant.claim(row.workspaceId);
      return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        name: row.name,
        workspaceId: row.workspaceId,
      };
    },

    async touch(id: string) {
      await db.update(device).set({ lastSeenAt: new Date() }).where(eq(device.id, id));
    },

    async list(userId: string): Promise<DeviceView[]> {
      const rows = await db
        .select()
        .from(device)
        .where(live(userId))
        .orderBy(asc(device.createdAt));
      const grants = await grantsOf(rows.map((r) => r.id));
      return rows.map((r) => view(r, grants.get(r.id) ?? []));
    },

    async setBots(a: ActiveActor, ref: string, botIds: string[]): Promise<DeviceView> {
      const row = await owned(a.userId, ref);
      const picked = await pickBots(a.userId, botIds);
      await db.transaction(async (tx) => {
        await tx.delete(deviceBot).where(eq(deviceBot.deviceId, row.id));
        if (picked.length)
          await tx
            .insert(deviceBot)
            .values(picked.map((botId) => ({ deviceId: row.id, botId, ownerUserId: a.userId })));
      });
      return view(row, picked);
    },

    /** Revokes the pairing: the connection closes now and the credential never works again. */
    async revoke(a: ActiveActor, ref: string) {
      const row = await owned(a.userId, ref);
      await db.update(device).set({ revokedAt: new Date() }).where(eq(device.id, row.id));
      await db.delete(deviceBot).where(eq(deviceBot.deviceId, row.id));
      hub.drop(row.id);
      await audit(db, a.userId, {
        kind: "connection",
        outcome: "ok",
        subjectId: row.id,
        detail: "device:revoked",
      });
    },

    /** Whether the person has a device by this name (used to route a bot's machine call). */
    async has(userId: string, ref: string): Promise<boolean> {
      return owned(userId, ref).then(
        () => true,
        () => false,
      );
    },

    /** What one bot may use, by name. Only the devices shared with that bot. */
    async catalog(userId: string, botId: string) {
      return (
        await db
          .select({ r: device })
          .from(device)
          .innerJoin(deviceBot, eq(deviceBot.deviceId, device.id))
          .where(and(live(userId), eq(deviceBot.botId, botId)))
          .orderBy(asc(device.createdAt))
      ).map(({ r }) => ({ name: r.name, kind: "device" as const, target: r.platform }));
    },

    /**
     * One operation for a bot, done by the app on that computer. The device must be shared with the bot (any other name is NOT_FOUND) and
     * connected. The person at the computer approves in the app; a refusal comes back as DENIED. The audit row never holds the output.
     */
    async exec(
      a: ActiveActor,
      ref: string,
      op: Op,
      ctx: { botId: string; botName?: string; signal?: AbortSignal },
    ): Promise<ExecResult & { machine: string }> {
      const row = await owned(a.userId, ref);
      const detail = `device:${op.type}`;
      const [grant] = await db
        .select({ botId: deviceBot.botId })
        .from(deviceBot)
        .where(and(eq(deviceBot.deviceId, row.id), eq(deviceBot.botId, ctx.botId)));
      if (!grant) {
        await audit(db, a.userId, {
          kind: "tool_call",
          outcome: "denied",
          botId: ctx.botId,
          subjectId: row.id,
          detail,
        });
        throw new ComputerError("NOT_FOUND");
      }
      if (op.type !== "run" && op.type !== "list") throw new ComputerError("UNSUPPORTED");
      try {
        const raw = (await hub.call(
          row.id,
          op.type,
          {
            ...(op.type === "run" ? { command: op.command } : { path: op.path }),
            bot: ctx.botName ?? "",
            botId: ctx.botId,
          },
          { signal: ctx.signal },
        )) as Partial<ExecResult> | null;
        const output = typeof raw?.output === "string" ? raw.output.slice(0, MAX_OUTPUT) : "";
        const result: ExecResult = {
          exitCode: typeof raw?.exitCode === "number" ? raw.exitCode : 1,
          output,
          truncated:
            Boolean(raw?.truncated) ||
            (typeof raw?.output === "string" && raw.output.length > MAX_OUTPUT),
        };
        await audit(db, a.userId, {
          kind: "tool_call",
          outcome: result.exitCode === 0 ? "ok" : "failed",
          botId: ctx.botId,
          subjectId: row.id,
          detail,
        });
        return { ...result, machine: row.name };
      } catch (e) {
        const code = e instanceof ComputerError ? e.code : undefined;
        await audit(db, a.userId, {
          kind: "tool_call",
          outcome: code === "SLOW" ? "timeout" : code === "DENIED" ? "denied" : "failed",
          botId: ctx.botId,
          subjectId: row.id,
          detail,
        });
        throw e;
      }
    },
  };
}

export type DeviceService = ReturnType<typeof createDeviceService>;
