/**
 * Builds the computer-use demo videos (each with a GIF preview) in docs/demo from recordings made by apps/server/src/scripts/vm-demo.ts.
 * Each recording is `<root>/<name>/` with the frames and events.json that ZETTA_VM_DEMO_FRAMES writes.
 *
 *   # one driver at a time (needs a built docker/desktop image) -> zetta-demo-computer-vm.mp4
 *   ZETTA_VM_DEMO_FRAMES=/tmp/rec/cua           bun run apps/server/src/scripts/vm-demo.ts cua
 *   ZETTA_VM_DEMO_FRAMES=/tmp/rec/agent-desktop bun run apps/server/src/scripts/vm-demo.ts agent-desktop
 *   bun docs/demo/build-vm-demo.ts /tmp/rec
 *
 *   # two machines (Debian + Cua, Ubuntu + agent-desktop; also needs the Ubuntu image) -> zetta-demo-two-machines.mp4
 *   ZETTA_VM_DEMO_FRAMES=/tmp/rec/machines ZETTA_VM_IMAGE_UBUNTU=... bun run apps/server/src/scripts/vm-demo.ts machines /tmp/rec/stills
 *   bun docs/demo/build-vm-demo.ts /tmp/rec machines
 *
 * Needs ffmpeg and ImageMagick (`magick`) on PATH. Captions use FONT (a .ttf/.ttc file; default: Helvetica on macOS, DejaVu on Linux).
 * The recordings show only the VM's own screen and a dummy credential.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = process.argv[2];
const kind = process.argv[3] ?? "browse";
if (!root || !["browse", "machines"].includes(kind)) {
  console.error("usage: bun docs/demo/build-vm-demo.ts <recordings dir> [machines]");
  process.exit(2);
}
const demo = import.meta.dir;
const FONT =
  process.env.FONT ??
  ["/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find(
    (f) => existsSync(f),
  );
if (!FONT) throw new Error("set FONT to a .ttf/.ttc file");

const W = 1280,
  SCREEN_H = 800,
  BAR_H = 72,
  H = SCREEN_H + BAR_H;
const work = join(root, "build");
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

const INK = "#0f1115";
const ACCENT = "#7dd3fc";
const GREY = "#a1a1aa";
const DRIVER_LABEL: Record<string, string> = { cua: "Cua", "agent-desktop": "agent-desktop" };
type Segment = { png: string; seconds: number };
type Line = { text: string; size: number; color?: string };

/** Text lines on the dark background, centered; with `top` they start that many pixels from the top instead. */
async function card(file: string, lines: Line[], top?: number) {
  const args = [
    "-size",
    `${W}x${H}`,
    `xc:${INK}`,
    "-font",
    FONT!,
    "-gravity",
    top === undefined ? "center" : "north",
  ];
  let y = top ?? -((lines.length - 1) * 26);
  for (const l of lines) {
    args.push(
      "-pointsize",
      String(l.size),
      "-fill",
      l.color ?? "white",
      "-annotate",
      `+0${y >= 0 ? "+" : ""}${y}`,
      l.text,
    );
    y += l.size + 22;
  }
  await $`magick ${args} ${file}`.quiet();
}
const captions = new Map<string, Promise<string>>();
/** The caption bar for one text and chip, written once (frames ask for it in parallel, so the promise is what is shared). */
function caption(chip: string, text: string) {
  const key = `${chip}|${text}`;
  let made = captions.get(key);
  if (!made) {
    const file = join(work, `cap-${captions.size}.png`);
    const args = [
      "-size",
      `${W}x${BAR_H}`,
      `xc:${INK}`,
      "-font",
      FONT!,
      "-pointsize",
      "27",
      "-fill",
      "white",
      "-gravity",
      "west",
      "-annotate",
      "+28+0",
      text,
      "-fill",
      ACCENT,
      "-gravity",
      "east",
      "-annotate",
      "+28+0",
      chip,
    ];
    made = $`magick ${args} ${file}`.quiet().then(() => file);
    captions.set(key, made);
  }
  return made;
}

/** One recording: each frame with the caption that was current when it was taken, held until the next frame. */
async function recording(name: string): Promise<Segment[]> {
  const dir = join(root, name);
  const { driver, events } = (await Bun.file(join(dir, "events.json")).json()) as {
    driver: string;
    events: { t: number; text: string; chip?: string }[];
  };
  const defaultChip = DRIVER_LABEL[driver] ?? driver;
  const frames = (await readdir(dir))
    .filter((f) => /^\d{5}-\d+\.png$/.test(f))
    .sort()
    .map((f) => ({ file: join(dir, f), t: Number(/-(\d+)\.png$/.exec(f)![1]) }));
  const segments: Segment[] = [];
  // Composite in small batches: ImageMagick is the slow part.
  for (let i = 0; i < frames.length; i += 8) {
    await Promise.all(
      frames.slice(i, i + 8).map(async (f, k) => {
        const event = [...events].reverse().find((e) => e.t <= f.t) ?? events[0]!;
        const out = join(work, `${name}-${String(i + k).padStart(5, "0")}.png`);
        await $`magick ${f.file} ${await caption(event.chip ?? defaultChip, event.text)} -append ${out}`.quiet();
        const next = frames[i + k + 1]?.t ?? f.t + 1200;
        segments[i + k] = { png: out, seconds: Math.min(1, Math.max(0.1, (next - f.t) / 1000)) };
      }),
    );
  }
  return segments;
}

async function encode(timeline: Segment[], mp4: string) {
  const list = join(work, "list.txt");
  await Bun.write(
    list,
    [
      ...timeline.map((s) => `file '${s.png}'\nduration ${s.seconds.toFixed(3)}`),
      `file '${timeline.at(-1)!.png}'`,
    ].join("\n"),
  );
  await $`ffmpeg -y -loglevel error -f concat -safe 0 -i ${list} -vf fps=25,format=yuv420p -c:v libx264 -preset slow -crf 28 -movflags +faststart ${mp4}`;
  await gif(mp4);
}

/**
 * A looping GIF next to the video. GitHub removes <video> tags from a README, so the README embeds this animation and links it to the mp4;
 * a GIF shows everywhere. The screens barely change, so 800 px at 6 fps stays around 1 MB and the terminal text stays legible.
 */
async function gif(mp4: string) {
  const filter =
    "fps=6,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle";
  await $`ffmpeg -y -loglevel error -i ${mp4} -vf ${filter} -loop 0 ${mp4.replace(/\.mp4$/, ".gif")}`;
}

if (kind === "browse") {
  const intro = join(work, "intro.png"),
    middle = join(work, "middle.png"),
    outro = join(work, "outro.png");
  await card(intro, [
    { text: "A bot uses a computer in Zetta", size: 56 },
    { text: "A private Linux desktop that bots and people share", size: 30, color: GREY },
    { text: "The same steps with two drivers: Cua, then agent-desktop", size: 30, color: ACCENT },
    {
      text: "Recorded from the VM's own screen · scripted steps, no model call",
      size: 24,
      color: "#71717a",
    },
  ]);
  await card(middle, [
    { text: "Same steps, now with agent-desktop", size: 52 },
    { text: "Chosen per computer in Studio > Computer", size: 28, color: GREY },
  ]);
  await card(outro, [
    { text: "Passwords are typed by the server, never seen by the bot", size: 40 },
    { text: "A person can take over at any moment and hand back", size: 30, color: GREY },
    { text: "Run it yourself: apps/server/src/scripts/vm-demo.ts", size: 24, color: "#71717a" },
  ]);
  const cua = await recording("cua");
  const ad = await recording("agent-desktop");
  const mp4 = join(demo, "zetta-demo-computer-vm.mp4");
  await encode(
    [
      { png: intro, seconds: 4 },
      ...cua,
      { png: middle, seconds: 2.5 },
      ...ad,
      { png: outro, seconds: 4.5 },
    ],
    mp4,
  );
  console.log(`wrote ${mp4} and its GIF`);
} else {
  const intro = join(work, "intro.png");
  await card(intro, [
    { text: "Two computers in Zetta", size: 56 },
    { text: "A new computer is a name, a system and a driver", size: 30, color: GREY },
    { text: "Debian 13 with Cua, then Ubuntu 24.04 with agent-desktop", size: 30, color: ACCENT },
    { text: "On each, the bot opens a terminal and runs uname -a", size: 24, color: "#71717a" },
  ]);
  // The finished machines side by side, from the stills the run saved after each terminal.
  const stills = join(root, "stills");
  const pick = async (suffix: string) =>
    join(
      stills,
      (await readdir(stills)).find((f) => f.endsWith(suffix))!,
    );
  const small = async (suffix: string, name: string) => {
    const out = join(work, name);
    // Only the terminal and what is behind it: the whole screen would shrink its text past reading.
    await $`magick ${await pick(suffix)} -crop 880x560+0+0 +repage -resize 620x ${out}`.quiet();
    return out;
  };
  const [debian, ubuntu] = [
    await small("debian-terminal.png", "debian-small.png"),
    await small("ubuntu-terminal.png", "ubuntu-small.png"),
  ];
  const heads = join(work, "both-heads.png");
  await card(
    heads,
    [
      { text: "Two computers, two systems, two drivers", size: 40 },
      {
        text: "Debian 13 · Cua          |          Ubuntu 24.04 · agent-desktop",
        size: 26,
        color: ACCENT,
      },
    ],
    16,
  );
  const both = join(work, "both.png");
  await $`magick ${heads} ${debian} -geometry +14+150 -composite ${ubuntu} -geometry +646+150 -composite -font ${FONT} -pointsize 24 -fill ${GREY} -gravity south -annotate +0+110 ${"uname -a prints the host's kernel on both (they are containers): the os-release line tells them apart"} -annotate +0+70 ${"Debian has a browser behind the terminal; Ubuntu is a desktop with a terminal only"} ${both}`.quiet();
  const rec = await recording("machines");
  const mp4 = join(demo, "zetta-demo-two-machines.mp4");
  await encode([{ png: intro, seconds: 4 }, ...rec, { png: both, seconds: 7 }], mp4);
  console.log(`wrote ${mp4} and its GIF`);
}
