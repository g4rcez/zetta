const START = String.fromCharCode(1),
  STOP = String.fromCharCode(2);

/** A passage from the server marks the words that matched between control characters 1 and 2. This splits it into plain and marked runs. */
export function splitPassage(passage: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let hit = false,
    run = "";
  const flush = () => {
    if (run) out.push({ text: run, hit });
    run = "";
  };
  for (const ch of passage) {
    if (ch === START || ch === STOP) {
      flush();
      hit = ch === START;
    } else run += ch;
  }
  flush();
  return out;
}
