/**
 * Demo: a person's Zetta desktop VM, driven the way a bot drives it, through the real VM service (the code behind /api/computer/vms and the
 * `zetta:desktop` tool). It starts one container from the desktop image, browses, clicks, signs in with a made-up credential, hands the
 * screen to a person and back, and saves a screenshot after each step.
 *
 *   ZETTA_DOCKER_BIN=/opt/podman/bin/podman ZETTA_VM_IMAGE=localhost/zetta-desktop:latest \
 *     bun run src/scripts/vm-demo.ts <cua|agent-desktop|machines> [outDir]
 *
 * `machines` shows two computers side by side: the default Debian one (Cua) and a new Ubuntu one (agent-desktop, no browser). On each the
 * bot opens a terminal and runs `uname -a`. It also needs ZETTA_VM_IMAGE_UBUNTU (docker build --build-arg BASE_IMAGE=ubuntu:24.04
 * --build-arg BROWSER=none, see docker/desktop/Dockerfile).
 *
 * With ZETTA_VM_DEMO_FRAMES=<dir> it also records the screen while it runs: `<n>-<ms>.png` frames (ms since the start) and `events.json`
 * with a caption for each step. docs/demo/build-vm-demo.sh turns those into the README video.
 *
 * It needs a built docker/desktop image and network access from the container. The VM and its volume are removed at the end. No database:
 * the rows live in memory. The credential is a fixed dummy; nothing is submitted.
 */
import { uuidv7 } from "@zetta/core/uuid";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputerError } from "../modules/computer/service";
import { DRIVERS, type DriverName } from "../modules/computer/drivers/types";
import { createVmService, dockerVmConfig, type VmRow, type VmStore } from "../modules/computer/vm";

const mode = process.argv[2];
const machines = mode === "machines";
const driver = (machines ? "cua" : mode) as DriverName;
if (!machines && !(DRIVERS as readonly string[]).includes(driver)) {
  console.error(`usage: bun run src/scripts/vm-demo.ts <${DRIVERS.join("|")}|machines> [outDir]`);
  process.exit(2);
}
const out = process.argv[3] ?? (await mkdtemp(join(tmpdir(), `zetta-vm-demo-${mode}-`)));
await mkdir(out, { recursive: true });
const framesDir = process.env.ZETTA_VM_DEMO_FRAMES;
if (framesDir) await mkdir(framesDir, { recursive: true });
const docker = dockerVmConfig({
  ZETTA_DESKTOP_RUNTIME: "docker",
  ZETTA_DOCKER_BIN: process.env.ZETTA_DOCKER_BIN,
  ZETTA_VM_IMAGE: process.env.ZETTA_VM_IMAGE,
  ZETTA_VM_IMAGE_UBUNTU: process.env.ZETTA_VM_IMAGE_UBUNTU,
})!;

const rows: VmRow[] = [];
const store: VmStore = {
  list: async () => rows.filter((r) => r.status !== "deleted"),
  get: async (_u, id) => rows.find((r) => r.id === id && r.status !== "deleted"),
  ensureDefault: async (u) => {
    if (!rows[0]) {
      rows.push({
        id: uuidv7(),
        ownerUserId: u,
        name: "Default",
        kind: "default",
        target: "vm",
        driver,
        os: "debian",
        createdByBotId: null,
        purpose: null,
        status: "stopped",
        createdAt: new Date(),
        lastStartedAt: null,
        deletedAt: null,
      });
    }
    return rows[0]!;
  },
  create: async (u, v) => {
    const row: VmRow = {
      id: uuidv7(),
      ownerUserId: u,
      name: v.name,
      kind: "extra",
      target: "vm",
      driver: v.driver ?? "cua",
      os: v.os ?? "debian",
      createdByBotId: null,
      purpose: v.purpose ?? null,
      status: "stopped",
      createdAt: new Date(),
      lastStartedAt: null,
      deletedAt: null,
    };
    rows.push(row);
    return row;
  },
  setDriver: async () => {},
  count: async () => rows.length,
  setStatus: async (id, status) => {
    rows.find((r) => r.id === id)!.status = status;
  },
  resetRunning: async () => {},
};
const vms = createVmService({
  store,
  docker,
  tokenRoot: await mkdtemp(join(tmpdir(), "zetta-vm-demo-")),
  vmDrivers: machines ? [...DRIVERS] : [driver],
  vmOs: machines ? ["debian", "ubuntu"] : ["debian"],
});

const t0 = Date.now();
const events: { t: number; text: string; chip?: string }[] = [];
/** A caption for the video: what the bot (or the person) is doing from now on. `chip` labels the computer when there is more than one. */
const note = (text: string, chip?: string) =>
  events.push({ t: Date.now() - t0, text, ...(chip ? { chip } : {}) });
let step = 0;
const say = (s: string) => console.log(`\n== ${++step}. ${s}`);
const shot = async (id: string, name: string) => {
  const file = join(out, `${String(step).padStart(2, "0")}-${name}.png`);
  await Bun.write(file, Buffer.from(await vms.screenshot("alice", id), "base64"));
  console.log(`   screenshot: ${file}`);
};
const show = (text: string, lines = 8) =>
  console.log(
    text
      .split("\n")
      .slice(0, lines)
      .map((l) => `   | ${l.slice(0, 110)}`)
      .join("\n"),
  );
const act = (id: string, a: Parameters<typeof vms.act>[3]) => vms.act("alice", id, "agent", a);

/** The computer the recorder films: the story moves it from one computer to the next. */
let watching: string | undefined;
/** Every computer this run made, so the end removes all of them. */
const made: string[] = [];
// Screen recording: frames as fast as the driver can capture them, named with the time they were taken.
let recording = Boolean(framesDir);
let frame = 0;
const recorder = framesDir
  ? (async () => {
      while (recording) {
        const t = Date.now() - t0;
        try {
          if (watching) {
            const png = await vms.screenshot("alice", watching);
            await Bun.write(
              join(framesDir, `${String(frame++).padStart(5, "0")}-${t}.png`),
              Buffer.from(png, "base64"),
            );
          }
        } catch {
          /* a frame lost while the page changes is not worth stopping for */
        }
        await Bun.sleep(100);
      }
    })()
  : undefined;

/** Two computers with different systems and drivers, side by side: on each the bot opens a terminal and runs `uname -a`. */
async function machinesDemo() {
  const chip = (os: string, d: string) =>
    `${os === "ubuntu" ? "Ubuntu 24.04" : "Debian 13"} · ${d === "cua" ? "Cua" : "agent-desktop"}`;
  const terminal = async (id: string, label: string) => {
    note("Bot: open a terminal", label);
    await act(id, { type: "launch", app: "xfce4-terminal" });
    await Bun.sleep(2200);
    for (const cmd of ["uname -a", "grep PRETTY_NAME /etc/os-release"]) {
      note(`Bot: run  ${cmd}`, label);
      await act(id, { type: "type", text: cmd });
      await act(id, { type: "key", key: "Return" });
      await Bun.sleep(1600);
    }
    await Bun.sleep(1500);
  };

  say("Your default computer: Debian 13, driven by Cua");
  const first = await vms.start("alice");
  made.push(first.id);
  watching = first.id;
  const label1 = chip(first.os, first.driver);
  note("Your default computer", label1);
  console.log(`   ${first.name}: ${first.os}, driver ${first.driver}, running`);
  await Bun.sleep(1500);
  await terminal(first.id, label1);
  await shot(first.id, "debian-terminal");

  say("Create a second computer: Ubuntu 24.04, driven by agent-desktop");
  const options = vms.options();
  console.log(
    `   systems offered: ${options.os.map((o) => `${o.label}${o.available ? "" : " (not available)"}`).join(", ")}`,
  );
  const ubuntu = await vms.create("alice", {
    name: "Ubuntu",
    os: "ubuntu",
    driver: "agent-desktop",
  });
  made.push(ubuntu.id);
  note("Create a new computer: Ubuntu 24.04", chip(ubuntu.os, ubuntu.driver));
  const second = await vms.start("alice", ubuntu.id);
  watching = second.id;
  const label2 = chip(second.os, second.driver);
  console.log(`   ${second.name}: ${second.os}, driver ${second.driver}, running`);
  await Bun.sleep(1500);
  await terminal(second.id, label2);
  await shot(second.id, "ubuntu-terminal");

  say("Both computers keep running, each with its own desktop and home");
  for (const v of await vms.list("alice"))
    console.log(`   ${v.name}: ${v.os}, ${v.driver}, ${v.status}`);
  note("Two computers, two systems, two drivers: each has its own desktop and home", label2);
  await Bun.sleep(1500);
}
if (machines) {
  try {
    await machinesDemo();
  } finally {
    recording = false;
    await recorder;
    if (framesDir)
      await Bun.write(
        join(framesDir, "events.json"),
        JSON.stringify({ driver: mode, events }, null, 1),
      );
    say("Remove the computers (containers and home volumes)");
    for (const id of made) await vms.remove("alice", id);
    await vms.closeAll();
    console.log(
      `   done in ${Math.round((Date.now() - t0) / 1000)} s${framesDir ? `, ${frame} frames` : ""}`,
    );
  }
  process.exit(0);
}

note(`Starting a private computer · driver: ${driver}`);
say(`Start alice's default computer (driver: ${driver})`);
const vm = await vms.start("alice");
made.push(vm.id);
watching = vm.id;
console.log(
  `   ${vm.name}: ${vm.status}, target ${vm.target}, driver ${vm.driver}, in ${Date.now() - t0} ms`,
);

try {
  note("Ready: Chromium is open on the computer's own desktop");
  await Bun.sleep(1200);
  await shot(vm.id, "desktop");

  say("Navigate to https://example.com and read the page like a bot");
  note("Bot: go to https://example.com");
  await act(vm.id, { type: "navigate", url: "https://example.com" });
  note("Bot: read the page as numbered text");
  const page = await vms.read("alice", vm.id, { settle: true });
  show(page);
  await shot(vm.id, "example");

  // The link sits below the fold: a bot scrolls first, then reads again for the numbers of what is on screen.
  say("Scroll down, read again, and click the link");
  note("Bot: scroll down, then read the page again");
  await act(vm.id, { type: "scroll", direction: "down", amount: 10 });
  const lower = await vms.read("alice", vm.id, { settle: true });
  const link = /\[(\d+)\] link "([^"]+)"(?! \(off-screen\))/.exec(lower);
  if (link) {
    console.log(`   clicking element [${link[1]}] (${link[2]})`);
    note(`Bot: click element [${link[1]}], the “${link[2]}” link`);
    await act(vm.id, { type: "click_element", n: Number(link[1]) });
    show(await vms.read("alice", vm.id, { settle: true }), 6);
    await shot(vm.id, "after-click");
  }

  say(
    "Open a sign-in page and fill a dummy credential (the server picks the input; the value never reaches the bot)",
  );
  note("Bot: open a sign-in page");
  await act(vm.id, { type: "navigate", url: "https://github.com/login" });
  for (let i = 0; i < 30; i++) {
    const text = await vms.read("alice", vm.id);
    if (/Password/.test(text)) break;
    await Bun.sleep(1000);
  }
  const asked: string[] = [];
  const reveal = (value: string) => async (url: string) => (asked.push(url), value);
  note("Zetta types the username (the bot never sees the value)");
  console.log(
    "   username ->",
    await vms.fillCredential("alice", vm.id, "username", reveal("demo-user")),
  );
  note("…and the password, only into the password field");
  console.log(
    "   password ->",
    await vms.fillCredential("alice", vm.id, "password", reveal("demo-not-a-real-password")),
  );
  console.log(`   the grant was checked against: ${[...new Set(asked)].join(", ")}`);
  await Bun.sleep(900);
  await shot(vm.id, "sign-in-filled");

  say("A person takes over: the bot is refused until they hand the screen back");
  note("A person takes over the screen");
  vms.takeover("alice", vm.id, true);
  const refused = await act(vm.id, { type: "key", key: "Escape" }).then(
    () => "allowed (unexpected)",
    (e) => (e instanceof ComputerError ? e.code : String(e)),
  );
  console.log(`   bot action while a person is in control: ${refused}`);
  note(`The bot is refused while the person is in control: ${refused}`);
  await Bun.sleep(1500);
  vms.takeover("alice", vm.id, false);
  note("The person hands the screen back");
  await act(vm.id, { type: "key", key: "Escape" });
  console.log("   after hand-back: the same action works");
  note("The bot continues");
  await Bun.sleep(1200);
} finally {
  recording = false;
  await recorder;
  if (framesDir)
    await Bun.write(join(framesDir, "events.json"), JSON.stringify({ driver, events }, null, 1));
  say("Remove the computer (container and home volume)");
  await vms.remove("alice", vm.id);
  await vms.closeAll();
  console.log(
    `   done in ${Math.round((Date.now() - t0) / 1000)} s${framesDir ? `, ${frame} frames` : ""}`,
  );
}
