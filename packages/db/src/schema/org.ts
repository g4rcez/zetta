import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { ORG_RANKS, ORG_SEATS } from "@zetta/core/org";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot } from "./chat";
import { team } from "./teams";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const stamp = (name: string) => timestamp(name, { withTimezone: true }).defaultNow().notNull();

export {
  ORG_DESCRIPTION_MAX,
  ORG_MAX_DEPTH,
  ORG_RANKS,
  ORG_SEATS,
  ORG_TITLE_MAX,
  ORG_UNIT_MAX,
  type OrgRank,
  type OrgSeat,
} from "@zetta/core/org";

/**
 * The company chart: one row per installation (one per workspace once workspaces land). `version` is the compare-and-swap token of every edit,
 * so two admins editing at once never overwrite each other silently.
 */
export const orgChart = zetta.table("org_chart", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text("name").default("Company").notNull(),
  version: integer("version").default(1).notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, restrict),
  createdAt: stamp("created_at"),
  updatedAt: stamp("updated_at"),
});

/**
 * A seat in the chart. `parentId` is "reports to": the root has none and is the CEO. A seat is held by nobody, a person or a bot; one
 * person may hold several seats (small companies do). `teamId` links the team that a lead seat runs; the team keeps its bot chief as
 * room coordinator.
 */
export const orgPosition = zetta.table(
  "org_position",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => orgChart.id, restrict),
    parentId: uuid("parent_id").references((): AnyPgColumn => orgPosition.id, restrict),
    rank: text("rank", { enum: ORG_RANKS }).default("member").notNull(),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    unit: text("unit").default("").notNull(),
    teamId: uuid("team_id").references(() => team.id, restrict),
    seat: text("seat", { enum: ORG_SEATS }).default("open").notNull(),
    userId: text("user_id").references(() => user.id, restrict),
    botId: uuid("bot_id").references(() => bot.id, restrict),
    /** The key of the role template the seat started from, for the "Template it came from" line. */
    templateKey: text("template_key"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (t) => [
    uniqueIndex("org_position_one_root")
      .on(t.chartId)
      .where(sql`${t.parentId} is null`),
    index("org_position_parent_id_idx").on(t.parentId),
    index("org_position_user_id_idx").on(t.userId),
    index("org_position_bot_id_idx").on(t.botId),
    index("org_position_team_id_idx").on(t.teamId),
    check("org_position_title_check", sql`length(btrim(${t.title})) between 1 and 80`),
    check("org_position_unit_check", sql`length(${t.unit}) <= 80`),
    check("org_position_description_check", sql`length(${t.description}) <= 600`),
    check("org_position_root_is_ceo_check", sql`(${t.parentId} is null) = (${t.rank} = 'ceo')`),
    check(
      "org_position_seat_check",
      sql`(${t.seat} = 'open' and ${t.userId} is null and ${t.botId} is null) or (${t.seat} = 'person' and ${t.userId} is not null and ${t.botId} is null) or (${t.seat} = 'bot' and ${t.botId} is not null and ${t.userId} is null)`,
    ),
  ],
);
