export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Above this many lines on each side (after the shared start and end are cut) the diff shows the whole old text removed and the whole new text added. */
const MAX_LINES = 1500;

/**
 * A line-by-line diff of two texts: what a reader needs to see what a save changed. Lines both texts share at the start and the end are
 * cut first, so the usual small edit is cheap; the middle is compared by the longest common run of lines.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: "same", text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: "same", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length > MAX_LINES || y.length > MAX_LINES)
    return [
      ...head,
      ...x.map((text): DiffLine => ({ kind: "del", text })),
      ...y.map((text): DiffLine => ({ kind: "add", text })),
      ...tail,
    ];
  // lcs[i][j]: the longest common run of x[i..] and y[j..].
  const lcs = Array.from({ length: x.length + 1 }, () =>
    Array.from({ length: y.length + 1 }, () => 0),
  );
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i]![j] =
        x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      middle.push({ kind: "same", text: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) middle.push({ kind: "del", text: x[i++]! });
    else middle.push({ kind: "add", text: y[j++]! });
  }
  while (i < x.length) middle.push({ kind: "del", text: x[i++]! });
  while (j < y.length) middle.push({ kind: "add", text: y[j++]! });
  return [...head, ...middle, ...tail];
}

/** How many lines were added and removed. */
export const diffStats = (lines: readonly DiffLine[]) => ({
  added: lines.filter((l) => l.kind === "add").length,
  removed: lines.filter((l) => l.kind === "del").length,
});
