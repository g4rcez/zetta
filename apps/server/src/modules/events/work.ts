/**
 * Work kicks: "something is waiting for the worker". A kick runs the handlers of this process (only a process that runs work registers
 * any) and, over a link, tells the other instances. Without a kick the worker still finds the work on its 30 s tick. A lost `poke`
 * is found too: the message it announced is read before the running reply closes, or answered by the next turn.
 */
import { uuidv7 } from "@zetta/core/uuid";
import { tenant } from "@zetta/db";

/** `poke`: a person wrote in a conversation where a bot is working; the argument is the turn key (`<userId>:<conversationId>`). */
export type WorkKind = "discussions" | "loop" | "poke";
const KINDS: ReadonlySet<string> = new Set<WorkKind>(["discussions", "loop", "poke"]);
/** `w`: the workspace the kick is for, so the instance that receives it works in that one (packages/db/src/tenant.ts). */
export type WorkMessage = { v: 1; from: string; k: WorkKind; a?: string; w?: string };
export type WorkLink = { send(message: WorkMessage): void };

export type Work = {
  readonly id: string;
  /** Registers what this process does for a kind of kick. */
  on(kind: WorkKind, handler: (arg?: string) => void): void;
  kick(kind: WorkKind, arg?: string): void;
  link(link: WorkLink | undefined): void;
  receive(message: unknown): void;
};

export function createWork(): Work {
  const id = uuidv7();
  const handlers = new Map<WorkKind, ((arg?: string) => void)[]>();
  let link: WorkLink | undefined;
  const run = (kind: WorkKind, arg?: string) => {
    for (const handler of handlers.get(kind) ?? [])
      try {
        handler(arg);
      } catch {
        /* a failing kick is retried by the tick */
      }
  };
  return {
    id,
    on(kind, handler) {
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
    },
    kick(kind, arg) {
      // Here the handlers run in the kicker's own workspace; another instance is told which one it is.
      run(kind, arg);
      const w = tenant.current();
      try {
        link?.send({
          v: 1,
          from: id,
          k: kind,
          ...(arg === undefined ? {} : { a: arg }),
          ...(w === undefined ? {} : { w }),
        });
      } catch {
        /* the tick finds the work */
      }
    },
    link(next) {
      link = next;
    },
    receive(message) {
      const m = message as Partial<WorkMessage> | null;
      if (!m || m.v !== 1 || m.from === id || typeof m.k !== "string" || !KINDS.has(m.k)) return;
      const arg = typeof m.a === "string" ? m.a : undefined;
      const kind = m.k as WorkKind;
      // A kick with no workspace (from an instance before workspaces) runs where work with none runs; the tick finds the rest.
      if (typeof m.w !== "string") return run(kind, arg);
      try {
        tenant.run(m.w, () => run(kind, arg));
      } catch {
        /* not a workspace id: dropped, the tick finds the work */
      }
    },
  };
}

const holder = globalThis as { zettaWork?: Work };
export const work: Work = (holder.zettaWork ??= createWork());
