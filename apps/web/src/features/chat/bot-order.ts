/** The server refuses a longer list (apps/server/src/modules/preferences/routes.ts). */
export const ORDER_LIMIT = 500;

type Ordered = { id: string; kind: string };

/** Bots in sidebar order: the chief first, then the person's order; bots they never placed keep the server's order. */
export function orderBots<B extends Ordered>(bots: B[], order: readonly string[]) {
  const chief = bots.find((b) => b.kind === "chief");
  const rank = (b: B) => {
    const i = order.indexOf(b.id);
    return i < 0 ? Infinity : i;
  };
  // Array.sort is stable, so unplaced bots keep the server's order after the ranked ones.
  const rest = bots.filter((b) => b !== chief).sort((a, b) => rank(a) - rank(b));
  return { chief, rest };
}

/** The saved order after one group (a folder's bots, in their new order) is placed; other groups keep their places. */
export function placeGroup(order: readonly string[], group: readonly string[]) {
  return [...order.filter((id) => !group.includes(id)), ...group].slice(-ORDER_LIMIT);
}

/** One bot one place up (-1) or down (+1) inside its group; `undefined` when it cannot move that way. */
export function moveInGroup(group: readonly string[], id: string, delta: -1 | 1) {
  const i = group.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.length) return undefined;
  const next = [...group];
  next.splice(j, 0, ...next.splice(i, 1));
  return { group: next, position: j + 1 };
}
