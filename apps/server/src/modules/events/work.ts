/**
 * Work kicks: "something is waiting for the worker". A kick runs the handlers of this process (only a process that runs work registers
 * any) and, over a link, tells the other instances. Without a kick the worker still finds the work on its 30 s tick.
 */
import { uuidv7 } from "@zetta/core/uuid";

export type WorkKind = "discussions" | "loop";
export type WorkMessage = { v: 1; from: string; k: WorkKind; a?: string };
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
      run(kind, arg);
      try {
        link?.send({ v: 1, from: id, k: kind, ...(arg === undefined ? {} : { a: arg }) });
      } catch {
        /* the tick finds the work */
      }
    },
    link(next) {
      link = next;
    },
    receive(message) {
      const m = message as Partial<WorkMessage> | null;
      if (!m || m.v !== 1 || m.from === id || (m.k !== "discussions" && m.k !== "loop")) return;
      run(m.k, typeof m.a === "string" ? m.a : undefined);
    },
  };
}

const holder = globalThis as { zettaWork?: Work };
export const work: Work = (holder.zettaWork ??= createWork());
