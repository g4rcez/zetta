import { canMove, childrenOf, validateTree, type OrgRank, type OrgSeat } from "@zetta/core/org";
import { orgPresetByKey, orgTemplateByKey, presetRows } from "@zetta/core/org-templates";
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { orgChart, orgPosition } from "@zetta/db/schema/org";
import { userPreference } from "@zetta/db/schema/preferences";
import { team } from "@zetta/db/schema/teams";
import type { ActiveActor } from "../identity/access";
import { buildOrgDraft, type OrgDraft, type OrgDraftChoices } from "./draft";
import { readOrgLinks, type OrgLink } from "./links";
import { createPeopleDirectory } from "../people/directory";

/** The most seats one chart holds: the canvas and the prompts stay readable, and one admin cannot fill the table. */
export const ORG_MAX_POSITIONS = 300;
/** A picture above this many characters is left out of the chart; the seat shows the initial instead. */
const AVATAR_MAX = 20_000;

/** Why an org rule refused a change. `safe` is shown to the person as it is. */
export class OrgError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND" | "NOT_ALLOWED" | "STALE_VERSION",
    readonly safe: string,
  ) {
    super(code);
    this.name = "OrgError";
  }
}

type Avatar = (typeof bot.$inferSelect)["avatar"];
type PositionRow = typeof orgPosition.$inferSelect;
type Tx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

/** Why a seat shows as open although somebody was put in it. */
export type OrgHolderProblem = "member_removed" | "bot_private" | "bot_archived" | "bot_missing";

export type OrgHolder =
  | { kind: "person"; userId: string; name: string; avatar: Avatar; jobTitle?: string }
  | {
      kind: "bot";
      botId: string;
      name: string;
      description: string;
      /** What the bot is for, in a few words; empty when its owner wrote none (the web falls back to the seat title). */
      role?: string;
      avatar: Avatar;
    };

export type OrgPositionView = {
  id: string;
  parentId: string | null;
  rank: OrgRank;
  title: string;
  description: string;
  unit: string;
  sortOrder: number;
  templateKey: string | null;
  /** What the seat is now: `open` also for a seat whose holder can no longer hold it (see `problem`). */
  seat: OrgSeat;
  holder: OrgHolder | null;
  /** Set when somebody was put in the seat and cannot hold it any more. `was` names them. */
  problem: { code: OrgHolderProblem; was: string; mine: boolean } | null;
  team: { id: string; name: string } | null;
};

export type OrgView = {
  /** `id` is null before the first edit; `version` is 0 then. */
  chart: { id: string | null; name: string; version: number };
  positions: OrgPositionView[];
  canEdit: boolean;
  /** Only for the admin: who can be put in a seat and which of their own teams can be linked. */
  palette: {
    people: { userId: string; name: string; avatar: Avatar; title: string }[];
    bots: { id: string; name: string; description: string; avatar: Avatar }[];
    teams: { id: string; name: string }[];
  } | null;
};

const smallAvatar = (a: Avatar): Avatar =>
  a && a.kind === "image" && a.src.length > AVATAR_MAX ? null : a;
const ids = <T>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => x !== null))];

/**
 * The chart as one reader sees it. A seat holder is shown only while they can still hold the seat: a person who left, or a bot that is
 * private or archived again, reads as an open seat with a note. Shared with the parts of the server that need the chart (prompts, cards).
 */
export async function readOrg(
  db: Pick<Database, "select">,
  readerUserId: string,
): Promise<Pick<OrgView, "chart" | "positions">> {
  const [chart] = await db
    .select()
    .from(orgChart)
    .orderBy(asc(orgChart.createdAt), asc(orgChart.id))
    .limit(1);
  if (!chart) return { chart: { id: null, name: "Company", version: 0 }, positions: [] };
  const rows = await db.select().from(orgPosition).where(eq(orgPosition.chartId, chart.id));
  const userIds = ids(rows.map((r) => r.userId));
  const botIds = ids(rows.map((r) => r.botId));
  const teamIds = ids(rows.map((r) => r.teamId));
  const [people, active, avatars, bots, teams] = await Promise.all([
    userIds.length
      ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
      : [],
    userIds.length
      ? db
          .select({ id: membership.userId })
          .from(membership)
          .where(and(inArray(membership.userId, userIds), eq(membership.status, "active")))
      : [],
    userIds.length
      ? db
          .select({
            id: userPreference.ownerUserId,
            avatar: userPreference.avatar,
            jobTitle: userPreference.jobTitle,
          })
          .from(userPreference)
          .where(inArray(userPreference.ownerUserId, userIds))
      : [],
    botIds.length
      ? db
          .select({
            id: bot.id,
            name: bot.name,
            description: bot.description,
            role: bot.role,
            avatar: bot.avatar,
            visibility: bot.visibility,
            kind: bot.kind,
            archived: bot.archived,
            ownerUserId: bot.ownerUserId,
          })
          .from(bot)
          .where(inArray(bot.id, botIds))
      : [],
    teamIds.length
      ? db
          .select({ id: team.id, name: team.name })
          .from(team)
          .where(and(inArray(team.id, teamIds), eq(team.status, "active")))
      : [],
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const isActive = new Set(active.map((m) => m.id));
  const avatarOf = new Map(avatars.map((a) => [a.id, a.avatar]));
  const jobTitleOf = new Map(avatars.map((a) => [a.id, a.jobTitle]));
  const botOf = new Map(bots.map((b) => [b.id, b]));
  const teamOf = new Map(teams.map((t) => [t.id, t.name]));
  const positions = rows
    .map((r): OrgPositionView => {
      const base = {
        id: r.id,
        parentId: r.parentId,
        rank: r.rank,
        title: r.title,
        description: r.description,
        unit: r.unit,
        sortOrder: r.sortOrder,
        templateKey: r.templateKey,
        team:
          r.teamId && teamOf.has(r.teamId) ? { id: r.teamId, name: teamOf.get(r.teamId)! } : null,
      };
      if (r.seat === "person" && r.userId) {
        const name = nameOf.get(r.userId) ?? "Someone";
        if (!isActive.has(r.userId))
          return {
            ...base,
            seat: "open",
            holder: null,
            problem: { code: "member_removed", was: name, mine: false },
          };
        return {
          ...base,
          seat: "person",
          holder: {
            kind: "person",
            userId: r.userId,
            name,
            avatar: smallAvatar(avatarOf.get(r.userId) ?? null),
            jobTitle: jobTitleOf.get(r.userId) ?? "",
          },
          problem: null,
        };
      }
      if (r.seat === "bot" && r.botId) {
        const b = botOf.get(r.botId);
        const mine = b?.ownerUserId === readerUserId;
        const out = (code: OrgHolderProblem): OrgPositionView => ({
          ...base,
          seat: "open",
          holder: null,
          problem: { code, was: b?.name ?? "A bot", mine },
        });
        if (!b) return out("bot_missing");
        if (b.archived) return out("bot_archived");
        if (b.visibility !== "team" || b.kind !== "specialist") return out("bot_private");
        return {
          ...base,
          seat: "bot",
          holder: {
            kind: "bot",
            botId: b.id,
            name: b.name,
            description: b.description,
            role: b.role,
            avatar: smallAvatar(b.avatar),
          },
          problem: null,
        };
      }
      return { ...base, seat: "open", holder: null, problem: null };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1));
  return { chart: { id: chart.id, name: chart.name, version: chart.version }, positions };
}

export type OrgCreate = {
  parentId?: string | null;
  templateKey?: string;
  title?: string;
  description?: string;
  unit?: string;
  rank?: OrgRank;
};
export type OrgUpdate = {
  title?: string;
  description?: string;
  unit?: string;
  rank?: OrgRank;
  teamId?: string | null;
};
export type OrgHolderInput =
  | { kind: "open" }
  | { kind: "person"; userId: string }
  | { kind: "bot"; botId: string };

const stale = () =>
  new OrgError("STALE_VERSION", "Someone changed the chart. Here is the latest; try again.");
const missing = () => new OrgError("NOT_FOUND", "That seat is not in the chart any more.");

export function createOrgStore(db: Database) {
  async function tell() {
    if (!store.onChange) return;
    try {
      const rows = await db
        .select({ id: membership.userId })
        .from(membership)
        .where(eq(membership.status, "active"));
      store.onChange(rows.map((r) => r.id));
    } catch {
      // Best effort: the next read shows the change anyway.
    }
  }

  /**
   * One edit, admin only: serialized under an advisory lock, checked against the version the person saw, and checked again as a whole
   * before it commits, so no operation can leave a chart that is broken.
   */
  async function mutate(
    a: ActiveActor,
    expectedVersion: number,
    work: (tx: Tx, rows: PositionRow[], chartId: string) => Promise<void>,
  ) {
    if (!a.isAdmin) throw new OrgError("NOT_ALLOWED", "Only the admin changes the chart.");
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('zetta.org_chart'))`);
      let [chart] = await tx
        .select()
        .from(orgChart)
        .orderBy(asc(orgChart.createdAt), asc(orgChart.id))
        .limit(1);
      if (!chart) {
        if (expectedVersion !== 0) throw stale();
        [chart] = await tx.insert(orgChart).values({ updatedByUserId: a.userId }).returning();
      } else if (chart.version !== expectedVersion) throw stale();
      const chartId = chart!.id;
      const rows = await tx.select().from(orgPosition).where(eq(orgPosition.chartId, chartId));
      await work(tx, rows, chartId);
      const after = await tx
        .select({ id: orgPosition.id, parentId: orgPosition.parentId, rank: orgPosition.rank })
        .from(orgPosition)
        .where(eq(orgPosition.chartId, chartId));
      if (after.length > ORG_MAX_POSITIONS)
        throw new OrgError("INVALID", `The chart can have at most ${ORG_MAX_POSITIONS} seats.`);
      const broken = validateTree(after);
      if (broken) throw new OrgError("INVALID", broken.message);
      await tx
        .update(orgChart)
        .set({
          version: sql`${orgChart.version} + 1`,
          updatedByUserId: a.userId,
          updatedAt: new Date(),
        })
        .where(eq(orgChart.id, chartId));
    });
    void tell();
  }

  const find = (rows: PositionRow[], id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw missing();
    return row;
  };
  const nextOrder = (rows: PositionRow[], parentId: string | null) =>
    Math.max(-1, ...rows.filter((r) => r.parentId === parentId).map((r) => r.sortOrder)) + 1;

  /** Writes `sortOrder` 0..n for these seats in this order, touching only the ones that changed. */
  async function renumber(tx: Tx, rows: PositionRow[], order: string[]) {
    for (const [i, id] of order.entries())
      if (rows.find((r) => r.id === id)?.sortOrder !== i)
        await tx
          .update(orgPosition)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(eq(orgPosition.id, id));
  }

  const store = {
    /** Told after every change with everyone who can read the chart, so open pages refresh. */
    onChange: undefined as ((userIds: string[]) => void) | undefined,

    /** The chart for anyone who is a member; the admin also gets the palette. */
    async get(a: ActiveActor): Promise<OrgView> {
      const view = await readOrg(db, a.userId);
      if (!a.isAdmin) return { ...view, canEdit: false, palette: null };
      const [people, bots, teams] = await Promise.all([
        db
          .select({ userId: user.id, name: user.name, avatar: userPreference.avatar })
          .from(membership)
          .innerJoin(user, eq(user.id, membership.userId))
          .leftJoin(userPreference, eq(userPreference.ownerUserId, user.id))
          .where(eq(membership.status, "active"))
          .orderBy(asc(user.name), asc(user.id)),
        db
          .select({ id: bot.id, name: bot.name, description: bot.description, avatar: bot.avatar })
          .from(bot)
          .where(
            and(eq(bot.visibility, "team"), eq(bot.kind, "specialist"), eq(bot.archived, false)),
          )
          .orderBy(asc(bot.name), asc(bot.id)),
        db
          .select({ id: team.id, name: team.name })
          .from(team)
          .where(and(eq(team.ownerUserId, a.userId), eq(team.status, "active")))
          .orderBy(asc(team.name), asc(team.id)),
      ]);
      // The title of each person as the rest of the app shows it: their own job title, else their seat.
      const titles = await createPeopleDirectory(db).lines(people.map((p) => p.userId));
      return {
        ...view,
        canEdit: true,
        palette: {
          people: people.map((p) => ({
            ...p,
            avatar: smallAvatar(p.avatar ?? null),
            title: titles.get(p.userId)?.title ?? "",
          })),
          bots: bots.map((b) => ({ ...b, avatar: smallAvatar(b.avatar) })),
          teams,
        },
      };
    },

    /** Adds a seat, from a role template or from scratch. The first seat of an empty chart is the CEO. */
    async create(a: ActiveActor, expectedVersion: number, v: OrgCreate) {
      await mutate(a, expectedVersion, async (tx, rows, chartId) => {
        const tpl = v.templateKey ? orgTemplateByKey(v.templateKey) : undefined;
        if (v.templateKey && !tpl)
          throw new OrgError("INVALID", "That role template does not exist.");
        const title = (v.title ?? tpl?.title ?? "").trim();
        if (!title) throw new OrgError("INVALID", "Give the seat a title.");
        const rank = v.rank ?? tpl?.rank ?? (rows.length ? "member" : "ceo");
        const parentId = v.parentId ?? null;
        if (rows.length === 0) {
          if (rank !== "ceo") throw new OrgError("INVALID", "Start the chart with the CEO.");
          if (parentId) throw missing();
        } else {
          if (!parentId) throw new OrgError("INVALID", "Pick the seat this one reports to.");
          find(rows, parentId);
          if (rank === "ceo") throw new OrgError("INVALID", "There can be only one CEO.");
        }
        await tx.insert(orgPosition).values({
          chartId,
          parentId,
          rank,
          title,
          description: (v.description ?? tpl?.description ?? "").trim(),
          unit: (v.unit ?? tpl?.unit ?? "").trim(),
          templateKey: tpl?.key ?? null,
          sortOrder: nextOrder(rows, parentId),
        });
      });
      return store.get(a);
    },

    /** Changes the words of a seat, its rank or the team it runs. The CEO stays the CEO. */
    async update(a: ActiveActor, expectedVersion: number, id: string, v: OrgUpdate) {
      await mutate(a, expectedVersion, async (tx, rows) => {
        const row = find(rows, id);
        if (v.rank !== undefined) {
          if (row.rank === "ceo" && v.rank !== "ceo")
            throw new OrgError("INVALID", "The CEO seat stays the CEO.");
          if (row.rank !== "ceo" && v.rank === "ceo")
            throw new OrgError("INVALID", "There can be only one CEO.");
        }
        if (v.teamId) {
          const [own] = await tx
            .select({ id: team.id })
            .from(team)
            .where(
              and(eq(team.id, v.teamId), eq(team.ownerUserId, a.userId), eq(team.status, "active")),
            );
          if (!own) throw new OrgError("INVALID", "You can link only teams that you own.");
        }
        const title = v.title?.trim();
        if (title === "") throw new OrgError("INVALID", "Give the seat a title.");
        await tx
          .update(orgPosition)
          .set({
            ...(title !== undefined && { title }),
            ...(v.description !== undefined && { description: v.description.trim() }),
            ...(v.unit !== undefined && { unit: v.unit.trim() }),
            ...(v.rank !== undefined && { rank: v.rank }),
            ...(v.teamId !== undefined && { teamId: v.teamId }),
            updatedAt: new Date(),
          })
          .where(eq(orgPosition.id, id));
      });
      return store.get(a);
    },

    /** Moves a seat under another one, or to another place among its siblings (`index`, from 0; the end by default). */
    async move(
      a: ActiveActor,
      expectedVersion: number,
      id: string,
      parentId: string,
      index?: number,
    ) {
      await mutate(a, expectedVersion, async (tx, rows) => {
        find(rows, id);
        const problem = canMove(rows, id, parentId);
        if (problem)
          throw new OrgError(
            problem.code === "not_found" ? "NOT_FOUND" : "INVALID",
            problem.message,
          );
        const siblings = childrenOf(rows, parentId)
          .map((r) => r.id)
          .filter((x) => x !== id);
        siblings.splice(Math.min(Math.max(index ?? siblings.length, 0), siblings.length), 0, id);
        await tx
          .update(orgPosition)
          .set({ parentId, updatedAt: new Date() })
          .where(eq(orgPosition.id, id));
        await renumber(tx, rows, siblings);
      });
      return store.get(a);
    },

    /** Puts a person or a bot in a seat, or empties it. Only team-visible specialist bots and active members can hold one. */
    async seat(a: ActiveActor, expectedVersion: number, id: string, holder: OrgHolderInput) {
      await mutate(a, expectedVersion, async (tx, rows) => {
        find(rows, id);
        if (holder.kind === "person") {
          const [m] = await tx
            .select({ id: membership.userId })
            .from(membership)
            .where(and(eq(membership.userId, holder.userId), eq(membership.status, "active")));
          if (!m) throw new OrgError("INVALID", "That person is not a member any more.");
        }
        if (holder.kind === "bot") {
          const [b] = await tx
            .select({ visibility: bot.visibility, kind: bot.kind, archived: bot.archived })
            .from(bot)
            .where(eq(bot.id, holder.botId));
          if (!b || b.archived) throw new OrgError("NOT_FOUND", "That bot is not available.");
          if (b.kind !== "specialist")
            throw new OrgError("INVALID", "A personal chief of staff cannot hold a seat.");
          if (b.visibility !== "team")
            throw new OrgError(
              "INVALID",
              "A private bot cannot hold a seat. Share it with the team first.",
            );
        }
        await tx
          .update(orgPosition)
          .set({
            seat: holder.kind,
            userId: holder.kind === "person" ? holder.userId : null,
            botId: holder.kind === "bot" ? holder.botId : null,
            updatedAt: new Date(),
          })
          .where(eq(orgPosition.id, id));
      });
      return store.get(a);
    },

    /** Removes a seat; the seats that reported to it report to its manager now. The CEO can go only when nobody reports to it. */
    async remove(a: ActiveActor, expectedVersion: number, id: string) {
      await mutate(a, expectedVersion, async (tx, rows) => {
        const row = find(rows, id);
        const reports = childrenOf(rows, id);
        if (!row.parentId && reports.length)
          throw new OrgError("INVALID", "Move or remove the seats under the CEO first.");
        if (row.parentId) {
          // The reports take the place of the removed seat among its siblings.
          const order = childrenOf(rows, row.parentId).flatMap((s) =>
            s.id === id ? reports.map((r) => r.id) : [s.id],
          );
          for (const r of reports)
            await tx
              .update(orgPosition)
              .set({ parentId: row.parentId, updatedAt: new Date() })
              .where(eq(orgPosition.id, r.id));
          await tx.delete(orgPosition).where(eq(orgPosition.id, id));
          await renumber(tx, rows, order);
        } else await tx.delete(orgPosition).where(eq(orgPosition.id, id));
      });
      return store.get(a);
    },

    /**
     * Builds a structure from a preset. A company preset (it starts with the CEO) needs an empty chart. A department preset hangs under
     * the seat given; on an empty chart it gets an open CEO seat above it.
     */
    async applyPreset(
      a: ActiveActor,
      expectedVersion: number,
      presetKey: string,
      underPositionId?: string,
    ) {
      const preset = orgPresetByKey(presetKey);
      if (!preset) throw new OrgError("NOT_FOUND", "That template does not exist.");
      await mutate(a, expectedVersion, async (tx, rows, chartId) => {
        const built = presetRows(preset);
        const empty = rows.length === 0;
        if (preset.scope === "company" && !empty)
          throw new OrgError(
            "INVALID",
            "A whole company template needs an empty chart. Add a team under a seat instead.",
          );
        const made: (typeof orgPosition.$inferInsert)[] = [];
        let attachTo: string | null = null;
        if (preset.scope === "department") {
          if (empty) {
            const ceo = orgTemplateByKey("ceo")!;
            attachTo = uuidv7();
            made.push({
              id: attachTo,
              chartId,
              parentId: null,
              rank: "ceo",
              title: ceo.title,
              description: ceo.description,
              unit: ceo.unit,
              templateKey: ceo.key,
              sortOrder: 0,
            });
          } else {
            if (!underPositionId)
              throw new OrgError("INVALID", "Pick the seat this team reports to.");
            attachTo = find(rows, underPositionId).id;
          }
        }
        const idOf = built.map(() => uuidv7());
        for (const r of built)
          made.push({
            id: idOf[r.ref]!,
            chartId,
            parentId: r.parentRef === null ? attachTo : idOf[r.parentRef]!,
            rank: r.rank,
            title: r.title,
            description: r.description,
            unit: r.unit,
            templateKey: r.templateKey,
            sortOrder: r.parentRef === null && attachTo ? nextOrder(rows, attachTo) : r.sortOrder,
          });
        if (rows.length + made.length > ORG_MAX_POSITIONS)
          throw new OrgError("INVALID", `The chart can have at most ${ORG_MAX_POSITIONS} seats.`);
        await tx.insert(orgPosition).values(made);
      });
      return store.get(a);
    },

    /**
     * A first chart drafted from the admin's teams, for the admin to review. Nothing is saved: `applyDraft` is the confirmation.
     * Only the admin reads it, because it lists the admin's own teams and the bots in them.
     */
    async draft(a: ActiveActor, choices: OrgDraftChoices = {}): Promise<OrgDraft> {
      if (!a.isAdmin) throw new OrgError("NOT_ALLOWED", "Only the admin draws the chart.");
      return buildOrgDraft(db, a.userId, choices);
    },

    /**
     * Saves the draft (the same one `draft` returns for the same choices) into an empty chart, in one step: the CEO seat, a leader seat per
     * team, and a seat for every bot the admin kept. Teams are linked to their leader seat.
     */
    async applyDraft(a: ActiveActor, expectedVersion: number, choices: OrgDraftChoices = {}) {
      await mutate(a, expectedVersion, async (tx, rows, chartId) => {
        if (rows.length)
          throw new OrgError("INVALID", "A draft from your teams needs an empty chart.");
        const draft = await buildOrgDraft(tx, a.userId, choices);
        if (draft.seats.length > ORG_MAX_POSITIONS)
          throw new OrgError("INVALID", `The chart can have at most ${ORG_MAX_POSITIONS} seats.`);
        const idOf = draft.seats.map(() => uuidv7());
        await tx.insert(orgPosition).values(
          draft.seats.map((s) => ({
            id: idOf[s.ref]!,
            chartId,
            parentId: s.parentRef === null ? null : idOf[s.parentRef]!,
            rank: s.rank,
            title: s.title,
            description: s.description,
            unit: s.unit,
            templateKey: s.templateKey,
            teamId: s.team?.id ?? null,
            seat: s.holder ? ("bot" as const) : ("open" as const),
            botId: s.holder?.botId ?? null,
            sortOrder: s.sortOrder,
          })),
        );
      });
      return store.get(a);
    },

    /** The bots of the chart that work together, from rooms, workflows and decision routes the reader has. */
    async links(a: ActiveActor): Promise<OrgLink[]> {
      const { positions } = await readOrg(db, a.userId);
      const seated = positions.flatMap((p) => (p.holder?.kind === "bot" ? [p.holder.botId] : []));
      return readOrgLinks(db, a.userId, seated);
    },
  };
  return store;
}

export type OrgStore = ReturnType<typeof createOrgStore>;
