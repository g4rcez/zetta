/**
 * Builds the computer-use demo videos (each with a GIF preview) in docs/demo from recordings of the Zetta dashboard made by
 * docs/demo/computer/record.ts. Each recording is `<root>/<name>/` with raw.webm and events.json.
 *
 *   docs/demo/computer/stack.sh up
 *   bun docs/demo/computer/record.ts browse      # -> $ZETTA_DEMO_DIR/rec/browse     -> zetta-demo-computer-vm.mp4
 *   docs/demo/computer/stack.sh up
 *   bun docs/demo/computer/record.ts machines    # -> $ZETTA_DEMO_DIR/rec/machines   -> zetta-demo-two-machines.mp4
 *   bun docs/demo/build-vm-demo.ts $ZETTA_DEMO_DIR/rec browse
 *   bun docs/demo/build-vm-demo.ts $ZETTA_DEMO_DIR/rec machines
 *
 * Needs ffmpeg and ImageMagick (`magick`) on PATH. Captions use FONT (a .ttf/.ttc file; default: Helvetica on macOS, DejaVu on Linux).
 * The recordings show the dashboard with fake data and a dummy sign-in; waits (a computer starting, a bot working) are sped up.
 */
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = process.argv[2];
const kind = process.argv[3];
if (!root || (kind !== "browse" && kind !== "machines")) {
  console.error("usage: bun docs/demo/build-vm-demo.ts <recordings dir> browse|machines");
  process.exit(2);
}
const demo = import.meta.dir;
const FONT =
  process.env.FONT ??
  ["/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find((f) => existsSync(f));
if (!FONT) throw new Error("set FONT to a .ttf/.ttc file");

// The recording is 1600x1000; the caption bar sits under it so that it never covers the dashboard.
const W = 1600,
  PAGE_H = 1000,
  BAR_H = 72,
  H = PAGE_H + BAR_H;
const work = join(root, kind, "build");
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

const INK = "#0f1115";
const ACCENT = "#7dd3fc";
const GREY = "#a1a1aa";
const DIM = "#71717a";
type Line = { text: string; size: number; color?: string };
type Recording = {
  ready: number;
  end: number;
  events: { t: number; text: string; chip?: string }[];
  idles: { from: number; to: number }[];
};

/** Text lines on the dark background, centered. */
async function card(file: string, lines: Line[]) {
  const args = ["-size", `${W}x${H}`, `xc:${INK}`, "-font", FONT!, "-gravity", "center"];
  let y = -((lines.length - 1) * 30);
  for (const l of lines) {
    args.push("-pointsize", String(l.size), "-fill", l.color ?? "white", "-annotate", `+0${y >= 0 ? "+" : ""}${y}`, l.text);
    y += l.size + 26;
  }
  await $`magick ${args} ${file}`.quiet();
}

/** The caption bar: the text on the left, the chip (driver or system) on the right. */
async function bar(file: string, text: string, chip: string) {
  const args = [
    "-size", `${W}x${BAR_H}`, `xc:${INK}`, "-font", FONT!, "-pointsize", "28",
    "-fill", "white", "-gravity", "west", "-annotate", "+32+0", text,
    "-fill", ACCENT, "-gravity", "east", "-annotate", "+32+0", chip,
  ];
  await $`magick ${args} ${file}`.quiet();
}

const FAST_MIN = 0.8,
  FAST_MAX = 2.2;
/** One recording as an mp4: idle waits sped up, captions in the bar under the page. */
async function clip(name: string, defaultChip: string) {
  const dir = join(root, name);
  const rec = (await Bun.file(join(dir, "events.json")).json()) as Recording;
  const [start, end] = [rec.ready / 1000, rec.end / 1000];

  // Segments of the source time line: normal speed, or sped up where record.ts marked an idle wait.
  const spans = rec.idles
    .map((i) => ({ from: Math.max(start, i.from / 1000), to: Math.min(end, i.to / 1000) }))
    .filter((i) => i.to - i.from > 1.5)
    .sort((a, b) => a.from - b.from);
  const segs: { from: number; to: number; speed: number }[] = [];
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

  const caps = rec.events.map((e, i) => ({
    file: join(work, `${name}-cap-${i}.png`),
    from: mapped(Math.max(start, e.t / 1000)),
    to: i + 1 < rec.events.length ? mapped(rec.events[i + 1]!.t / 1000) : total,
    text: e.text,
    chip: e.chip ?? defaultChip,
  }));
  for (const c of caps) await bar(c.file, c.text, c.chip);

  const cut = segs.map((s, i) => `[0:v]trim=start=${s.from}:end=${s.to},setpts=(PTS-STARTPTS)/${s.speed}[v${i}]`);
  const joined = `${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,fps=25,pad=${W}:${H}:0:0:color=${INK}[base]`;
  const over = caps.map(
    (c, i) =>
      `[${i === 0 ? "base" : `o${i - 1}`}][${i + 1}:v]overlay=0:${PAGE_H}:enable='between(t,${c.from.toFixed(3)},${c.to.toFixed(3)})'[o${i}]`,
  );
  const last = caps.length ? `o${caps.length - 1}` : "base";
  const graph = [...cut, joined, ...over].join(";");
  const out = join(work, `${name}.mp4`);
  const inputs = caps.flatMap((c) => ["-i", c.file]);
  await $`ffmpeg -y -loglevel error -i ${join(dir, "raw.webm")} ${inputs} -filter_complex ${graph} -map ${`[${last}]`} -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p ${out}`;
  console.log(`${name}: ${total.toFixed(0)} s (from ${(end - start).toFixed(0)} s recorded)`);
  return out;
}

/** A still card as a clip with the same encoding as the recording, so that the parts can be joined without re-encoding. */
async function still(png: string, seconds: number) {
  const out = png.replace(/\.png$/, ".mp4");
  await $`ffmpeg -y -loglevel error -loop 1 -t ${seconds} -i ${png} -vf fps=25,format=yuv420p -c:v libx264 -preset slow -crf 27 ${out}`;
  return out;
}

async function join_(parts: string[], mp4: string) {
  const list = join(work, "list.txt");
  await Bun.write(list, parts.map((p) => `file '${p}'`).join("\n"));
  await $`ffmpeg -y -loglevel error -f concat -safe 0 -i ${list} -c copy -movflags +faststart ${mp4}`;
  await gif(mp4);
}

/**
 * A looping GIF next to the video. GitHub removes <video> tags from a README, so the README embeds this animation and links it to the mp4;
 * a GIF shows everywhere. Low frame rate keeps it small: the screens change slowly.
 */
async function gif(mp4: string) {
  const filter =
    "fps=5,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle";
  await $`ffmpeg -y -loglevel error -i ${mp4} -vf ${filter} -loop 0 ${mp4.replace(/\.mp4$/, ".gif")}`;
}

const intro = join(work, "intro.png"),
  outro = join(work, "outro.png");
if (kind === "browse") {
  await card(intro, [
    { text: "A bot uses a computer in Zetta", size: 60 },
    { text: "In the dashboard: ask in chat, watch live, take over, hand back", size: 32, color: GREY },
    { text: "The same steps with two drivers: Cua, then agent-desktop", size: 32, color: ACCENT },
    { text: "Scripted bot replies, no model call · waits shortened", size: 26, color: DIM },
  ]);
  await card(outro, [
    { text: "A person can take over at any moment and hand back", size: 44 },
    { text: "What you type goes to the computer, not into the chat", size: 32, color: GREY },
    { text: "Run it yourself: docs/demo/computer/stack.sh", size: 26, color: DIM },
  ]);
  const parts = [await still(intro, 4.5), await clip("browse", "Cua"), await still(outro, 4.5)];
  const mp4 = join(demo, "zetta-demo-computer-vm.mp4");
  await join_(parts, mp4);
  console.log(`wrote ${mp4} and its GIF`);
} else {
  await card(intro, [
    { text: "Two computers in Zetta", size: 60 },
    { text: "A new computer is a name, a system and a driver", size: 32, color: GREY },
    { text: "Debian 13 with Cua, then Ubuntu 24.04 with agent-desktop", size: 32, color: ACCENT },
    { text: "One bot runs the same commands on both · scripted, no model call", size: 26, color: DIM },
  ]);
  await card(outro, [
    { text: "Two computers, two systems, two drivers", size: 44 },
    { text: "uname -a prints the host's kernel on both (they are containers): the os-release line tells them apart", size: 26, color: GREY },
    { text: "Debian has a browser behind the terminal; Ubuntu is a desktop with a terminal only", size: 26, color: GREY },
  ]);
  const parts = [await still(intro, 4.5), await clip("machines", "Debian 13 · Cua"), await still(outro, 6)];
  const mp4 = join(demo, "zetta-demo-two-machines.mp4");
  await join_(parts, mp4);
  console.log(`wrote ${mp4} and its GIF`);
}
