/**
 * Shared by build-vm-demo.ts and build-landing-clips.ts: reads what docs/demo/computer/record.ts wrote and works out which parts of the
 * recording play at normal speed and which waits (a computer starting, a bot thinking) are sped up.
 */

export type Recording = {
  ready: number;
  end: number;
  events: { t: number; text: string; chip?: string }[];
  idles: { from: number; to: number }[];
};

export type Segment = { from: number; to: number; speed: number };

const FAST_MIN = 0.8,
  FAST_MAX = 2.2;

export async function readRecording(dir: string): Promise<Recording> {
  return (await Bun.file(`${dir}/events.json`).json()) as Recording;
}

/** The recording as segments of the source time line (seconds), plus a map from source time to time in the sped-up clip. */
export function timeline(rec: Recording) {
  const [start, end] = [rec.ready / 1000, rec.end / 1000];
  const spans = rec.idles
    .map((i) => ({ from: Math.max(start, i.from / 1000), to: Math.min(end, i.to / 1000) }))
    .filter((i) => i.to - i.from > 1.5)
    .sort((a, b) => a.from - b.from);
  const segs: Segment[] = [];
  let at = start;
  for (const s of spans) {
    if (s.from > at) segs.push({ from: at, to: s.from, speed: 1 });
    const target = Math.min(FAST_MAX, Math.max(FAST_MIN, (s.to - s.from) / 12));
    segs.push({ from: s.from, to: s.to, speed: (s.to - s.from) / target });
    at = s.to;
  }
  if (at < end) segs.push({ from: at, to: end, speed: 1 });
  // Source time -> time in the clip.
  const starts: number[] = [];
  let total = 0;
  for (const s of segs) {
    starts.push(total);
    total += (s.to - s.from) / s.speed;
  }
  const mapped = (t: number) => {
    const i = segs.findIndex((s) => t < s.to);
    if (i < 0) return total;
    return starts[i]! + (Math.max(t, segs[i]!.from) - segs[i]!.from) / segs[i]!.speed;
  };
  return { start, end, segs, total, mapped };
}

/** The ffmpeg filters that cut each segment out of input 0 and speed it up: `[v0]`, `[v1]`, ... */
export const cutFilters = (segs: Segment[]) =>
  segs.map(
    (s, i) => `[0:v]trim=start=${s.from}:end=${s.to},setpts=(PTS-STARTPTS)/${s.speed}[v${i}]`,
  );

/** The labels of the cut segments, ready to feed `concat`. */
export const segmentLabels = (segs: Segment[]) => segs.map((_, i) => `[v${i}]`).join("");
