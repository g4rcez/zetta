import type { Database } from "@zetta/db";
import { and, desc, eq, ne, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { outputStyle, type OutputStyleScope } from "@zetta/db/schema/output-styles";
import { looksSecret } from "../features/safety";
import { BUILTIN_STYLES, builtinStyle, type BuiltinStyle } from "./builtins";
import { fromMarkdown, STYLE_LIMITS, StyleFormatError, toMarkdown, type StyleDoc } from "./format";

export class OutputStyleError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID" | "SECRET_REJECTED" | "FULL") {
    super(code);
  }
}

/** A shared style counts only while its owner is an active member, so removing a member withdraws what they shared. */
const ownerIsActive = sql`exists (select 1 from ${membership} m where m.user_id = ${outputStyle.ownerUserId} and m.status = 'active')`;
const readableBy = (userId: string) =>
  or(
    eq(outputStyle.ownerUserId, userId),
    and(eq(outputStyle.scope, "installation"), ownerIsActive),
  );

/**
 * The text a bot adds to its prompt. A custom style resolves while the bot's owner can read it, even after it was archived, so deleting a
 * template never silently changes a bot's tone. When the style is gone or no longer shared, the bot falls back to Default.
 */
export async function resolveOutputStyle(
  db: Database,
  bot: { ownerUserId: string; outputStyle: string; outputStyleId: string | null },
): Promise<string> {
  if (bot.outputStyle !== "custom") return builtinStyle(bot.outputStyle)?.body ?? "";
  if (!bot.outputStyleId) return "";
  const [row] = await db
    .select({ body: outputStyle.body })
    .from(outputStyle)
    .where(and(eq(outputStyle.id, bot.outputStyleId), readableBy(bot.ownerUserId)));
  return row?.body ?? "";
}

/** Throws NOT_FOUND unless `userId` may attach this style to a bot (own style, or shared by an active member; not archived). */
export async function assertCanUseStyle(
  db: Database,
  userId: string,
  styleId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: outputStyle.id })
    .from(outputStyle)
    .where(and(eq(outputStyle.id, styleId), eq(outputStyle.archived, false), readableBy(userId)));
  if (!row) throw new OutputStyleError("NOT_FOUND");
}

/**
 * Checks the style a bot create or patch asks for. A patch that touches either field must send both, and they must agree:
 * `custom` goes with a style id, every other key goes without one. Throws INVALID or NOT_FOUND.
 */
export async function assertStyleChoice(
  db: Database,
  userId: string,
  choice: { outputStyle?: string; outputStyleId?: string | null },
): Promise<void> {
  const { outputStyle: key, outputStyleId: id } = choice;
  if (key === undefined && id === undefined) return;
  if (key === undefined || id === undefined) throw new OutputStyleError("INVALID");
  if ((key === "custom") !== (id !== null)) throw new OutputStyleError("INVALID");
  if (id !== null) await assertCanUseStyle(db, userId, id);
}

export type StyleView = {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: OutputStyleScope;
  version: number;
  mine: boolean;
  ownerName: string;
  updatedAt: Date;
};

export type StyleFields = StyleDoc & { scope?: OutputStyleScope };

export function createOutputStyles(db: Database) {
  const view = (userId: string) => ({
    id: outputStyle.id,
    name: outputStyle.name,
    description: outputStyle.description,
    body: outputStyle.body,
    scope: outputStyle.scope,
    version: outputStyle.version,
    updatedAt: outputStyle.updatedAt,
    ownerId: outputStyle.ownerUserId,
    ownerName: user.name,
    mine: sql<boolean>`${outputStyle.ownerUserId} = ${userId}`,
  });
  const screen = (v: { name?: string; description?: string; body?: string }) => {
    if (looksSecret(`${v.name ?? ""}\n${v.description ?? ""}\n${v.body ?? ""}`))
      throw new OutputStyleError("SECRET_REJECTED");
  };

  async function load(userId: string, id: string) {
    const [row] = await db
      .select(view(userId))
      .from(outputStyle)
      .innerJoin(user, eq(user.id, outputStyle.ownerUserId))
      .where(and(eq(outputStyle.id, id), eq(outputStyle.archived, false), readableBy(userId)));
    if (!row) throw new OutputStyleError("NOT_FOUND");
    return row;
  }

  async function create(userId: string, v: StyleFields) {
    screen(v);
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(outputStyle)
      .where(and(eq(outputStyle.ownerUserId, userId), eq(outputStyle.archived, false)));
    if (n >= STYLE_LIMITS.perOwner) throw new OutputStyleError("FULL");
    const [row] = await db
      .insert(outputStyle)
      .values({
        ownerUserId: userId,
        name: v.name.trim(),
        description: v.description,
        body: v.body.trim(),
        scope: v.scope ?? "private",
      })
      .returning({ id: outputStyle.id });
    return load(userId, row!.id);
  }

  return {
    builtins: (): readonly BuiltinStyle[] => BUILTIN_STYLES,

    /** My styles first, then the ones other active members shared. Archived styles are left out. */
    async list(userId: string) {
      const styles = await db
        .select(view(userId))
        .from(outputStyle)
        .innerJoin(user, eq(user.id, outputStyle.ownerUserId))
        .where(and(eq(outputStyle.archived, false), readableBy(userId)))
        .orderBy(desc(sql`${outputStyle.ownerUserId} = ${userId}`), desc(outputStyle.updatedAt))
        .limit(500);
      return { builtins: BUILTIN_STYLES, styles };
    },

    create,

    async update(userId: string, id: string, expectedVersion: number, v: Partial<StyleFields>) {
      screen(v);
      const [row] = await db
        .update(outputStyle)
        .set({
          ...(v.name !== undefined ? { name: v.name.trim() } : {}),
          ...(v.description !== undefined ? { description: v.description } : {}),
          ...(v.body !== undefined ? { body: v.body.trim() } : {}),
          ...(v.scope !== undefined ? { scope: v.scope } : {}),
          version: sql`${outputStyle.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outputStyle.id, id),
            eq(outputStyle.ownerUserId, userId),
            eq(outputStyle.archived, false),
            eq(outputStyle.version, expectedVersion),
          ),
        )
        .returning({ id: outputStyle.id });
      if (!row) {
        const [exists] = await db
          .select({ id: outputStyle.id })
          .from(outputStyle)
          .where(
            and(
              eq(outputStyle.id, id),
              eq(outputStyle.ownerUserId, userId),
              eq(outputStyle.archived, false),
            ),
          );
        throw new OutputStyleError(exists ? "CONFLICT" : "NOT_FOUND");
      }
      return load(userId, id);
    },

    /** Archive, never delete: bots that point to the style keep working. Only the owner may archive. */
    async archive(userId: string, id: string) {
      const [row] = await db
        .update(outputStyle)
        .set({ archived: true, version: sql`${outputStyle.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(outputStyle.id, id),
            eq(outputStyle.ownerUserId, userId),
            ne(outputStyle.archived, true),
          ),
        )
        .returning({ id: outputStyle.id });
      if (!row) throw new OutputStyleError("NOT_FOUND");
      return { id: row.id };
    },

    /** The imported style is always private to the importer, whatever the file says. */
    async importMarkdown(userId: string, markdown: string) {
      try {
        return await create(userId, fromMarkdown(markdown));
      } catch (e) {
        if (e instanceof StyleFormatError) throw new OutputStyleError("INVALID");
        throw e;
      }
    },

    async exportStyle(userId: string, id: string) {
      const s = await load(userId, id);
      return { filename: fileName(s.name), markdown: toMarkdown(s) };
    },

    exportBuiltin(key: string) {
      const s = builtinStyle(key);
      if (!s?.body) throw new OutputStyleError("NOT_FOUND");
      return { filename: fileName(s.name), markdown: toMarkdown(s) };
    },
  };
}

export type OutputStyles = ReturnType<typeof createOutputStyles>;

/** An ASCII file name: the header must never carry user text as is. */
const fileName = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "output-style"
  }.md`;
