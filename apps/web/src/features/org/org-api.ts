import type { OrgRank, OrgSeat } from "@zetta/core/org";
import { queryOptions } from "@tanstack/react-query";

import { call, type BotAvatarValue } from "../chat/chat-client";

export type { OrgRank, OrgSeat };

export type OrgHolder =
  | { kind: "person"; userId: string; name: string; avatar: unknown; jobTitle?: string }
  | {
      kind: "bot";
      botId: string;
      name: string;
      description: string;
      avatar: BotAvatarValue | null;
    };
/** Why a seat reads as open although somebody was put in it. `mine`: the reader owns that bot. */
export type OrgProblemCode = "member_removed" | "bot_private" | "bot_archived" | "bot_missing";
export type OrgProblem = { code: OrgProblemCode; was: string; mine: boolean };

export type OrgPosition = {
  id: string;
  parentId: string | null;
  rank: OrgRank;
  title: string;
  description: string;
  unit: string;
  sortOrder: number;
  templateKey: string | null;
  seat: OrgSeat;
  holder: OrgHolder | null;
  problem: OrgProblem | null;
  team: { id: string; name: string } | null;
};

export type OrgPalette = {
  people: { userId: string; name: string; avatar: unknown; title?: string }[];
  bots: { id: string; name: string; description: string; avatar: BotAvatarValue | null }[];
  teams: { id: string; name: string }[];
};

export type OrgView = {
  /** `id` is null before the first edit; `version` is 0 then. */
  chart: { id: string | null; name: string; version: number };
  positions: OrgPosition[];
  canEdit: boolean;
  /** Only the admin gets it. */
  palette: OrgPalette | null;
};

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

const org = (r: { org: OrgView }) => r.org;
const body = (expectedVersion: number, v: object = {}) => ({ expectedVersion, ...v });

/** Every write names the version of the chart the person saw; the server refuses it when somebody changed the chart since. */
export const orgApi = {
  get: () => call<{ org: OrgView }>("/api/org").then(org),
  create: (version: number, v: OrgCreate) =>
    call<{ org: OrgView }>("/api/org/positions", "POST", body(version, v)).then(org),
  update: (version: number, id: string, v: OrgUpdate) =>
    call<{ org: OrgView }>(`/api/org/positions/${id}`, "PATCH", body(version, v)).then(org),
  move: (version: number, id: string, parentId: string, index?: number) =>
    call<{ org: OrgView }>(
      `/api/org/positions/${id}/move`,
      "POST",
      body(version, { parentId, ...(index !== undefined && { index }) }),
    ).then(org),
  seat: (version: number, id: string, holder: OrgHolderInput) =>
    call<{ org: OrgView }>(`/api/org/positions/${id}/seat`, "PUT", body(version, { holder })).then(
      org,
    ),
  remove: (version: number, id: string) =>
    call<{ org: OrgView }>(`/api/org/positions/${id}?expectedVersion=${version}`, "DELETE").then(
      org,
    ),
  applyPreset: (version: number, presetKey: string, underPositionId?: string) =>
    call<{ org: OrgView }>(
      "/api/org/presets",
      "POST",
      body(version, { presetKey, ...(underPositionId && { underPositionId }) }),
    ).then(org),
};

export const orgQueries = {
  get: () => queryOptions({ queryKey: ["org"], queryFn: () => orgApi.get(), staleTime: 30_000 }),
};
