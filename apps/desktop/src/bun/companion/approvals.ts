import type { Decision } from "./policy";

export type PendingApproval = {
  id: string;
  serverName: string;
  bot: string;
  /** `run` or `list`. */
  method: string;
  /** The command line, or the path. Shown in full: the person decides on exactly this. */
  detail: string;
  /** Guarded commands (deletes, root, mail) can only be allowed once. */
  guarded: string[];
  askedAt: number;
};

/**
 * What waits for the person at this computer. Each request is shown until it is answered or its time runs out (then it is refused). The
 * launcher page lists them and sends the answer back by id.
 */
export function createApprovals(
  options: {
    timeoutMs?: number;
    now?: () => number;
    newId?: () => string;
    onChange?: (all: PendingApproval[]) => void;
  } = {},
) {
  const {
    timeoutMs = 120_000,
    now = Date.now,
    newId = () => crypto.randomUUID(),
    onChange,
  } = options;
  const waiting = new Map<
    string,
    {
      item: PendingApproval;
      settle: (decision: Decision) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const changed = () => onChange?.([...waiting.values()].map((w) => w.item));
  return {
    list: (): PendingApproval[] => [...waiting.values()].map((w) => ({ ...w.item })),
    /** Asks, and resolves with the person's answer; no answer in time is a refusal. */
    ask(input: Omit<PendingApproval, "id" | "askedAt">): Promise<Decision> {
      return new Promise((resolve) => {
        const id = newId();
        const settle = (decision: Decision) => {
          const entry = waiting.get(id);
          if (!entry) return;
          clearTimeout(entry.timer);
          waiting.delete(id);
          changed();
          resolve(decision);
        };
        const timer = setTimeout(() => settle("deny"), timeoutMs);
        waiting.set(id, { item: { ...input, id, askedAt: now() }, settle, timer });
        changed();
      });
    },
    /** The person's answer. `always` for a guarded command counts as `once`. Returns false for an unknown or already answered id. */
    decide(id: string, decision: Decision): boolean {
      const entry = waiting.get(id);
      if (!entry) return false;
      entry.settle(decision === "always" && entry.item.guarded.length ? "once" : decision);
      return true;
    },
    /** Refuses everything that waits (sharing was stopped, or the app is quitting). */
    denyAll() {
      for (const entry of waiting.values()) entry.settle("deny");
    },
  };
}
export type Approvals = ReturnType<typeof createApprovals>;
