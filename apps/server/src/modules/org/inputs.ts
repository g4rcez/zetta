import { ORG_DESCRIPTION_MAX, ORG_RANKS, ORG_TITLE_MAX, ORG_UNIT_MAX } from "@zetta/core/org";
import { z } from "zod";

/**
 * The inputs of the company chart, shared by the HTTP routes and the MCP tools so a seat means the same thing on both. The ids of the
 * seat an edit is about travel in the path of a route and in the input of an MCP tool, so they are not part of these bodies.
 */
export const orgUuid = z.string().uuid();
/** The version of the chart the caller read; 0 is a chart that does not exist yet. */
export const orgVersion = z.number().int().min(0);
export const orgTitle = z.string().trim().min(1).max(ORG_TITLE_MAX);
export const orgDescription = z.string().trim().max(ORG_DESCRIPTION_MAX);
export const orgUnit = z.string().trim().max(ORG_UNIT_MAX);
export const orgRank = z.enum(ORG_RANKS);

export const orgHolder = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open") }),
  z.strictObject({ kind: z.literal("person"), userId: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal("bot"), botId: orgUuid }),
]);

/**
 * What to do when the bot picked for a seat is private. `team` shares it with the team in the same step; left out, a private bot is
 * refused. Only the web page sends it: the bot tools and MCP keep asking the owner to share first.
 */
export const orgShareBot = z.enum(["team"]);

export const orgBodies = {
  create: z.strictObject({
    expectedVersion: orgVersion,
    parentId: orgUuid.nullable().optional(),
    templateKey: z.string().trim().min(1).max(60).optional(),
    title: orgTitle.optional(),
    description: orgDescription.optional(),
    unit: orgUnit.optional(),
    rank: orgRank.optional(),
    /** Who holds the new seat; written in the same step as the seat, so a refused holder leaves no seat behind. */
    holder: orgHolder.optional(),
    shareBot: orgShareBot.optional(),
  }),
  update: z.strictObject({
    expectedVersion: orgVersion,
    title: orgTitle.optional(),
    description: orgDescription.optional(),
    unit: orgUnit.optional(),
    rank: orgRank.optional(),
    teamId: orgUuid.nullable().optional(),
  }),
  move: z.strictObject({
    expectedVersion: orgVersion,
    parentId: orgUuid,
    index: z.number().int().min(0).max(1000).optional(),
  }),
  seat: z.strictObject({
    expectedVersion: orgVersion,
    holder: orgHolder,
    shareBot: orgShareBot.optional(),
  }),
  preset: z.strictObject({
    expectedVersion: orgVersion,
    presetKey: z.string().trim().min(1).max(60),
    underPositionId: orgUuid.optional(),
  }),
  /** What the admin kept on the preview of "draw it from my teams": the ids of teams and bots left out. */
  draft: z.strictObject({
    expectedVersion: orgVersion,
    skipTeamIds: z.array(orgUuid).max(300).optional(),
    skipBotIds: z.array(orgUuid).max(300).optional(),
  }),
  draftQuery: z.object({
    skipTeamIds: z.string().max(12_000).optional(),
    skipBotIds: z.string().max(12_000).optional(),
  }),
  expected: z.strictObject({ expectedVersion: z.coerce.number().int().min(0) }),
};
