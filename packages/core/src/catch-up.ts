import type { DecisionActions, DecisionKind } from "./attention-kinds";

/**
 * What `GET /api/catch-up` sends. The queue has two sources: approvals (`config_proposal`, decided through
 * `POST /api/proposals/:id/decision`) and attention cards of a decision kind (decided through `POST /api/catch-up/:id/act|deny`).
 * Erasable syntax only: the server and the web app both import this file.
 */

/** A little context about the thing a card is about, read when the queue is built. Every field is optional. */
export type CatchUpContext = {
  /** Name of the task, loop goal, room, routine, workflow, memory page or bot the card is about. */
  subject?: string;
  /** Its status in plain words, for example "paused" or "failed". */
  status?: string;
  /** The plugin to reconnect (`connection_lost`). */
  plugin?: string;
  /** How many suggestions wait on a memory page. */
  pending?: number;
  /** One more line worth showing, for example why a memory change is suggested. */
  extra?: string;
};

type Base = {
  /** Stable across refreshes: `proposal:<id>` or `card:<id>`. */
  key: string;
  botId: string | null;
  createdAt: string;
  /** Where the card was raised, for "Open in chat". */
  resultLink: string | null;
};

export type CatchUpProposalItem<P = unknown> = Base & {
  source: "proposal";
  id: string;
  /** A proposal waits only until this time. */
  expiresAt: string;
  /** The `config_proposal` row plus its `confirm` mode, the same object the chat footer gets from `GET /api/proposals`. */
  proposal: P;
};

export type CatchUpCardItem = Base & {
  source: "card";
  id: string;
  kind: DecisionKind;
  /** The routine, loop, task, room, memory page or channel the card is about (null for cards that name none). */
  subjectId: string | null;
  title: string;
  detail: string;
  nextAction: string;
  occurrences: number;
  context: CatchUpContext;
  actions: DecisionActions;
};

export type CatchUpItem<P = unknown> = CatchUpProposalItem<P> | CatchUpCardItem;

export type CatchUpSummary = {
  count: number;
  /** Decisions waiting per bot, for the sidebar. Items with no bot are only in `count`. */
  byBot: Record<string, number>;
};
