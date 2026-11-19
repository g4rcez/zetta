/**
 * Small text helpers for lessons. Pure, no imports: matching a candidate with one already known, deciding whether a lesson was about the
 * work a reply did, and reading whether the person said a rule outright. None of this asks a model.
 */

const STOP = new Set(
  (
    "the a an and or but if then than that this these those to of in on at by for with from as is are was were be been being it its " +
    "i you he she we they me my your our their them us do does did done not no yes so can could should would will just also very " +
    "o a os as um uma uns umas e ou mas se que de do da dos das em no na nos nas por para com como foi sao ser ao aos eu voce nos " +
    "ele ela eles elas meu minha seu sua nao sim ja mais muito so tambem"
  ).split(" "),
);

const strip = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The meaningful words of a text: lower case, no accents, no short words, no filler. */
export function tokens(text: string): string[] {
  return [
    ...new Set(
      strip(text.toLowerCase())
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ];
}

/** Words two texts share, over all their words: 1 is the same set, 0 shares none. */
export function jaccard(a: string, b: string): number {
  const x = new Set(tokens(a)),
    y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/**
 * Whether a lesson was about the work of a reply: it shares a meaningful word (its own, or its topic's) with what the person asked or
 * what the bot answered. A lesson for every reply (`always`) is about all of them.
 */
export function relevant(
  lesson: { text: string; topic: string; scope: "topic" | "always" },
  context: string,
): boolean {
  if (lesson.scope === "always") return true;
  const mine = tokens(`${lesson.text} ${lesson.topic}`);
  if (!mine.length) return false;
  const there = new Set(tokens(context));
  return mine.some((w) => there.has(w));
}

/** A short label for a tag: lower case, letters and digits joined by dashes, at most 40 characters. */
export function topicTag(topic: string): string {
  return strip(topic.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const SAID_OUTRIGHT = [
  /\bfrom now on\b/i,
  /\bgoing forward\b/i,
  /\bin the future\b/i,
  /\bevery time\b/i,
  /\beach time\b/i,
  /\bnext time\b/i,
  /\balways\b/i,
  /\bnever\b/i,
  /\ba partir de agora\b/i,
  /\bde agora em diante\b/i,
  /\bda proxima vez\b/i,
  /\btoda vez\b/i,
  /\bsempre\b/i,
  /\bnunca\b/i,
];

/**
 * True when the person's own words state a rule outright ("from now on…", "always…", "nunca…"). Read from their message, never from
 * what a model says they meant: it is the one thing that lets a lesson start on a single sighting.
 */
export function saidOutright(message: string): boolean {
  const text = strip(message);
  return SAID_OUTRIGHT.some((r) => r.test(text));
}
