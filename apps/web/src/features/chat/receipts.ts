import type { Receipt } from "./chat-client";

/**
 * One receipt per thing the bot touched. A bot that updates a task twice in one reply, or hands the same member's open task over
 * again, saves two receipts with the same kind and id; rendered as they are they share a React key. The later one wins (newest
 * title, assignee and done-when), it keeps the place of the first, and the thing counts as created when any of them created it.
 */
export function uniqueReceipts(receipts: Receipt[]): Receipt[] {
  const byKey = new Map<string, Receipt>();
  for (const r of receipts) {
    const key = `${r.kind}-${r.id}`;
    const before = byKey.get(key);
    byKey.set(
      key,
      before ? { ...before, ...r, created: (before.created ?? true) || (r.created ?? true) } : r,
    );
  }
  return byKey.size === receipts.length ? receipts : [...byKey.values()];
}

/** The kinds of receipt that fold into one chip when a reply touched several of them: the repeated "updated …" lines of a bulk change. */
export const GROUPED_KINDS: readonly Receipt["kind"][] = ["task", "agenda", "playground"];

/** One chip of the receipts line: a single receipt, or several of the same kind and verb folded together. */
export type ReceiptGroup = {
  key: string;
  kind: Receipt["kind"];
  /** False: the bot changed something that existed ("updated"), not made it. */
  created: boolean;
  items: Receipt[];
};

/**
 * Folds receipts of the same kind and verb into one group, so a bot that updated four tasks shows one "updated 4 tasks" chip and not four
 * lines that start with the same word. Groups keep the place of their first receipt; other kinds (memory with its undo, skills, artifacts)
 * stay one chip each.
 */
export function groupReceipts(receipts: Receipt[]): ReceiptGroup[] {
  const groups: ReceiptGroup[] = [];
  const open = new Map<string, ReceiptGroup>();
  for (const r of receipts) {
    const created = r.created !== false;
    const key = GROUPED_KINDS.includes(r.kind)
      ? `${r.kind}:${created ? "made" : "changed"}`
      : `${r.kind}-${r.id}`;
    const group = open.get(key);
    if (group) group.items.push(r);
    else {
      const next: ReceiptGroup = { key, kind: r.kind, created, items: [r] };
      open.set(key, next);
      groups.push(next);
    }
  }
  return groups;
}
