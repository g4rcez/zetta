/** A piece of a transcript: what was said between two moments, in seconds. */
export type Cue = { start: number; end: number; text: string };

const TIMING =
  /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s+-->\s+(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const seconds = (h: string | undefined, m: string, s: string, ms: string) =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
const decode = (t: string) =>
  t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * Cues of a WebVTT file. Tags (`<c>`, `<00:00:01.500>`, `<i>`) are dropped. YouTube's automatic captions roll: every cue repeats the
 * line before it and adds one, and some cues last a few milliseconds only to hold that repetition. A line that the cue before already
 * showed is dropped, and a cue left empty disappears, so the text reads once.
 */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  let prevLines: string[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at < 0) continue;
    const m = TIMING.exec(lines[at]!)!;
    const start = seconds(m[1], m[2]!, m[3]!, m[4]!);
    const end = seconds(m[5], m[6]!, m[7]!, m[8]!);
    const own = lines
      .slice(at + 1)
      .map((l) =>
        decode(l.replace(/<[^>]*>/g, ""))
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    const fresh = own.filter((l) => !prevLines.includes(l));
    prevLines = own;
    if (!fresh.length) continue;
    const text = fresh.join(" ");
    const last = cues[cues.length - 1];
    if (last && last.text === text) {
      last.end = Math.max(last.end, end);
      continue;
    }
    cues.push({ start, end: Math.max(end, start), text });
  }
  return cues;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function stamp(t: number, sep: "," | ".") {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3_600_000),
    m = Math.floor((ms % 3_600_000) / 60_000),
    s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export const toSrt = (cues: Cue[]) =>
  cues
    .map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`)
    .join("\n");

export const toVtt = (cues: Cue[]) =>
  `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;

/** The words alone. Captions are short fragments of one sentence, so they join with a space; long windows of speech stay on their own lines. */
export const toText = (cues: Cue[], separator = "\n") =>
  cues
    .map((c) => c.text)
    .join(separator)
    .trim();
