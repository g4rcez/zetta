/**
 * Builds the light-theme clips for the landing page from recordings of the real Zetta web app (docs/demo/computer/record.ts).
 * Each recording is `<root>/<name>/` with raw.webm and events.json. No caption bars, no title cards, no audio: the page is the clip.
 *
 *   docs/demo/computer/stack.sh up && bun docs/demo/computer/record.ts team      # -> $ZETTA_DEMO_DIR/rec/team
 *   docs/demo/computer/stack.sh up && bun docs/demo/computer/record.ts machines  # -> $ZETTA_DEMO_DIR/rec/machines
 *   docs/demo/computer/stack.sh up && bun docs/demo/computer/record.ts browse    # -> $ZETTA_DEMO_DIR/rec/browse
 *   docs/demo/computer/stack.sh down
 *   bun docs/demo/build-landing-clips.ts $ZETTA_DEMO_DIR/rec team|machines|browse
 *
 * The page's rows each have a clip too: record routines|memory|inbox|tasks|chats the same way (each on a fresh `stack.sh up`, then
 * `bun docs/demo/computer/seed-landing.ts`; see the header of record.ts) and build them with the same command and the scenario name.
 *
 * Writes to apps/landing/public/videos/ (or OUT_DIR): team.*, computer.* (from machines), browser.* (from browse), and routines.*,
 * memory.*, inbox.*, tasks.*, chats.*, each as .mp4 (H.264,
 * yuv420p, +faststart), .webm (VP9) and a -poster.webp. Waits are sped up like build-vm-demo.ts does (docs/demo/recording-timeline.ts).
 * Needs ffmpeg and ImageMagick (`magick`, with WebP support) on PATH. POSTER_AT=<0..1> picks the poster frame as a fraction of the clip (default: per clip, see PLAN).
 */
import { mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { cutFilters, readRecording, segmentLabels, timeline } from "./recording-timeline.ts";

const root = process.argv[2];
const kind = process.argv[3];
const KINDS = [
  "team",
  "machines",
  "browse",
  "routines",
  "memory",
  "inbox",
  "tasks",
  "chats",
] as const;
type Kind = (typeof KINDS)[number];
if (!root || !KINDS.includes(kind as Kind)) {
  console.error(`usage: bun docs/demo/build-landing-clips.ts <recordings dir> ${KINDS.join("|")}`);
  process.exit(2);
}

/** What each scenario becomes: file name, width (the recording is 16:10), and the size budget per format in MB. */
const PLAN = {
  team: { name: "team", width: 1600, height: 1000, megabytes: 5, seconds: 40, poster: 0.6 },
  machines: { name: "computer", width: 1008, height: 630, megabytes: 3, seconds: 20, poster: 0.45 },
  // The page's feature rows: pages of the real app, 1008x630 like the two clips above.
  routines: { name: "routines", width: 1008, height: 630, megabytes: 3, seconds: 18, poster: 0.55 },
  memory: { name: "memory", width: 1008, height: 630, megabytes: 3, seconds: 20, poster: 0.2 },
  inbox: { name: "inbox", width: 1008, height: 630, megabytes: 3, seconds: 14, poster: 0.1 },
  tasks: { name: "tasks", width: 1008, height: 630, megabytes: 3, seconds: 18, poster: 0.1 },
  chats: { name: "chats", width: 1008, height: 630, megabytes: 3, seconds: 16, poster: 0.8 },
  // The recording runs the same flow twice (Cua, then agent-desktop); one run is enough for the page: stop where the second begins.
  browse: {
    name: "browser",
    width: 1008,
    height: 630,
    megabytes: 3,
    seconds: 20,
    stopAt: /^Each computer has a driver/,
  },
} as const;
const plan: (typeof PLAN)[Kind] & { stopAt?: RegExp } = PLAN[kind as Kind];
const outDir = process.env.OUT_DIR ?? resolve(import.meta.dir, "../../apps/landing/public/videos");
const FPS = 24;

const dir = join(root, kind);
const work = join(dir, "landing-build");
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await mkdir(outDir, { recursive: true });

const rec = await readRecording(dir);
const stop = plan.stopAt && rec.events.find((e) => plan.stopAt!.test(e.text));
if (stop) rec.end = stop.t;
const { segs, total: sped } = timeline(rec);
// The recording pauses so that a viewer of build-vm-demo.ts can read its captions; with no captions those pauses are dead time. After the
// idle waits are sped up, the parts at normal speed play faster (up to MAX_TEMPO) until the clip is about `plan.seconds` long.
const MAX_TEMPO = 3;
const normal = segs.filter((s) => s.speed === 1).reduce((sum, s) => sum + (s.to - s.from), 0);
const fast = sped - normal;
const tempo = Math.min(MAX_TEMPO, Math.max(1, normal / Math.max(1, plan.seconds - fast)));
for (const s of segs) if (s.speed === 1) s.speed = tempo;
const total = fast + normal / tempo;
const graph = [
  ...cutFilters(segs),
  `${segmentLabels(segs)}concat=n=${segs.length}:v=1:a=0,fps=${FPS},scale=${plan.width}:${plan.height}:flags=lanczos,format=yuv420p[out]`,
];
// One intermediate at high quality, so each target format is encoded from it without going through the speed-up again.
const master = join(work, "master.mkv");
await $`ffmpeg -y -loglevel error -i ${join(dir, "raw.webm")} -filter_complex ${graph.join(";")} -map [out] -an -c:v libx264 -preset veryfast -crf 12 ${master}`;
console.log(
  `${plan.name}: ${total.toFixed(0)} s (from ${((rec.end - rec.ready) / 1000).toFixed(0)} s recorded, ${tempo.toFixed(2)}x between waits), ${plan.width}x${plan.height}`,
);

const budget = plan.megabytes * 1024 * 1024;
/** Encodes with the first quality (lowest CRF first) whose file fits the budget. */
async function encode(ext: "mp4" | "webm", crfs: number[], args: (crf: number) => string[]) {
  const target = join(outDir, `${plan.name}.${ext}`);
  for (const crf of crfs) {
    await $`ffmpeg -y -loglevel error -i ${master} -an ${args(crf)} ${target}`;
    const size = (await stat(target)).size;
    console.log(`  ${plan.name}.${ext} crf ${crf}: ${(size / 1024 / 1024).toFixed(2)} MB`);
    if (size <= budget) return;
  }
  console.warn(
    `  ${plan.name}.${ext} is over its ${plan.megabytes} MB budget at the highest CRF tried`,
  );
}
await encode("mp4", [20, 22, 24, 26, 28, 30, 32, 34], (crf) => [
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  String(crf),
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
]);
await encode("webm", [28, 30, 32, 34, 36, 38, 40, 42], (crf) => [
  "-c:v",
  "libvpx-vp9",
  "-b:v",
  "0",
  "-crf",
  String(crf),
  "-row-mt",
  "1",
  "-pix_fmt",
  "yuv420p",
]);

const at = (Number(process.env.POSTER_AT ?? plan.poster) * total).toFixed(2);
const still = join(work, "poster.png");
await $`ffmpeg -y -loglevel error -ss ${at} -i ${master} -frames:v 1 ${still}`;
await $`magick ${still} -quality 88 ${join(outDir, `${plan.name}-poster.webp`)}`; // this ffmpeg has no libwebp encoder
await rm(work, { recursive: true, force: true });
console.log(`wrote ${plan.name}.mp4, ${plan.name}.webm and ${plan.name}-poster.webp in ${outDir}`);
