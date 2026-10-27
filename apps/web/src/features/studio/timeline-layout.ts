export type TimelineRun = {
  id: string;
  routineId: string;
  title: string;
  status: "running" | "succeeded" | "failed" | "skipped" | "blocked" | "interrupted";
  trigger: string;
  conversationId: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type TimelineBar = { run: TimelineRun; left: number; width: number };
export type TimelineLane = { routineId: string; title: string; bars: TimelineBar[] };

/** Lays runs out on a [from, to] axis as percentages, one lane per routine; running runs extend to `now`. */
export function layoutTimeline(
  runs: readonly TimelineRun[],
  from: number,
  to: number,
  now: number,
): TimelineLane[] {
  const span = to - from;
  const lanes = new Map<string, TimelineLane>();
  for (const run of runs) {
    const start = Math.max(new Date(run.startedAt).getTime(), from);
    const end = Math.min(run.finishedAt ? new Date(run.finishedAt).getTime() : now, to);
    const lane = lanes.get(run.routineId) ?? {
      routineId: run.routineId,
      title: run.title,
      bars: [],
    };
    lane.bars.push({
      run,
      left: ((start - from) / span) * 100,
      width: Math.max(((end - start) / span) * 100, 0.8),
    });
    lanes.set(run.routineId, lane);
  }
  return [...lanes.values()].sort(
    (a, b) =>
      Number(b.bars.some((x) => x.run.status === "running")) -
        Number(a.bars.some((x) => x.run.status === "running")) || a.title.localeCompare(b.title),
  );
}
