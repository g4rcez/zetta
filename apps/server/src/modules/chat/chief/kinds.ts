import { chiefSchemas } from "./schemas";

/** The block kinds only the chief may send (`zetta:bot`, `zetta:routine`, ...). */
export const CHIEF_KINDS: ReadonlySet<string> = new Set(Object.keys(chiefSchemas));
/** Actions that only read. Every other action of a chief kind changes something and waits for the user's approval. */
const READS = new Set([
  "list",
  "get",
  "export",
  "test",
  "dry_run",
  "preview",
  "vms",
  "status",
  "suggestions",
  "works_with",
  "stats",
]);

/**
 * Chief kinds that the administrator's own bots may send too, not only the Chief. A read answers at once and every change is still a card
 * the administrator approves. Anyone else's bot, and a bot the administrator only shares with the team, is refused.
 */
export const ADMIN_BOT_KINDS: ReadonlySet<string> = new Set(["org"]);
export const adminBotMay = (
  kind: string,
  who: { ownerUserId: string },
  actor: { userId: string; isAdmin: boolean },
) => ADMIN_BOT_KINDS.has(kind) && actor.isAdmin && who.ownerUserId === actor.userId;
/**
 * Chief kinds whose reads any of the person's own bots may send too (not only the Chief and the administrator's bots). The lessons a bot
 * follows are the person's own; every change still waits for the Chief and the person's approval.
 */
const OWN_BOT_READ_KINDS: ReadonlySet<string> = new Set(["lessons"]);
export const ownBotMay = (
  kind: string,
  action: string,
  who: { ownerUserId: string },
  actor: { userId: string },
) => OWN_BOT_READ_KINDS.has(kind) && READS.has(action) && who.ownerUserId === actor.userId;
/** What a bot is told when it may not use a chief kind. */
export const chiefOnlyMessage = (kind: string) =>
  ADMIN_BOT_KINDS.has(kind)
    ? `${kind}: only the administrator's own bots can use the company chart.`
    : `${kind}: only the chief can do this.`;

/** A call the chief tools handle: a chief kind, or removing a task (the one task action only the chief has). */
export const isChiefCall = (c: { kind: string; args: unknown }) =>
  CHIEF_KINDS.has(c.kind) ||
  (c.kind === "task" && (c.args as { action?: string }).action === "remove");

export const isChiefWrite = (c: { kind: string; args: unknown }) =>
  CHIEF_KINDS.has(c.kind) && !READS.has((c.args as { action?: string }).action ?? "");

/** One proposal kind carries every chief action; the patch names the tool. */
export const CHIEF_PROPOSAL = "chief_action" as const;
/**
 * The only proposals the end-of-turn auto-apply may approve for the user, on a turn that read no outside content. Everything else
 * stays a card, so a new kind (or a kind that exists because the turn could not be trusted, like `bot_permission`) waits for a click
 * unless someone adds it here on purpose. It was a deny list; a grant to a bot slipped through it (docs/security/plan.md C3).
 */
export const AUTO_APPLY = [
  "config",
  "create_bot",
  "create_routine",
  "create_workflow",
  "create_vm",
  "open_discussion",
  "start_loop",
] as const;
