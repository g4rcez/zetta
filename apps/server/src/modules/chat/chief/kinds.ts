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
]);

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
