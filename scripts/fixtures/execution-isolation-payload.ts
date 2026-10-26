// Synthetic code only. Never import application code or read launcher/host environment here.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const role = process.argv[2];
const mode = process.argv[3];
const check = (value: boolean) => { if (!value) process.exit(21); };
const text = (path: string) => readFileSync(path, "utf8");
if (role === "B") {
  check(text("/input/canary") === process.env.FIXTURE_TOKEN);
  process.on("SIGUSR1", () => process.exit(22));
  writeFileSync("/scratch/heartbeat", String(Date.now()));
  setInterval(() => writeFileSync("/scratch/heartbeat", String(Date.now())), 50);
} else if (role === "health") {
  check(Date.now() - Number(text("/scratch/heartbeat")) < 1500);
} else if (role === "A") {
  if (mode === "overflow") {
    for (let i = 0; i < 128; i++) process.stdout.write("x".repeat(4096));
    setInterval(() => {}, 1000);
  } else if (mode === "memory-pressure") {
    // Finite committed allocation, only in the inspected 128 MiB container.
    const blocks: Buffer[] = [];
    for (let i = 0; i < 24; i++) blocks.push(Buffer.alloc(8 * 1024 * 1024, 1));
    check(blocks.length === 24);
    process.exit(24); // Surviving the bound is a failed enforcement proof.
  } else if (mode === "cpu-pressure") {
    const counters = () => Object.fromEntries(text("/sys/fs/cgroup/cpu.stat").trim().split("\n").map(line => line.split(" ")));
    check(text("/sys/fs/cgroup/cpu.max").trim() === "100000 100000");
    const before = counters();
    const children = Array.from({ length: 2 }, () => Bun.spawn([process.execPath, "--no-env-file", "-e", "const end=performance.now()+2500; let n=0; while(performance.now()<end)n++; if(n<1)process.exit(1)"], { stdout: "ignore", stderr: "ignore" }));
    check((await Promise.all(children.map(child => child.exited))).every(code => code === 0));
    const after = counters();
    check(Number(after.nr_throttled) > Number(before.nr_throttled));
    check(Number(after.usage_usec) - Number(before.usage_usec) > 500_000);
    process.stdout.write("ok");
  } else if (mode === "pid-pressure") {
    const events = () => Number(text("/sys/fs/cgroup/pids.events").trim().split(" ")[1]);
    check(text("/sys/fs/cgroup/pids.max").trim() === "32");
    const before = events();
    const child = Bun.spawn(["/bin/sh", "-c", "echo ready; i=0; while [ $i -lt 40 ]; do sleep 3 & i=$((i+1)); done; wait"], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(child.stdout).text();
    check(output === "ready\n" && await child.exited !== 0 && events() > before);
    check(Number(text("/sys/fs/cgroup/pids.current")) <= 32);
    process.stdout.write("ok");
  } else if (mode === "cancel" || mode === "deadline") {
    if (mode === "deadline") process.on("SIGTERM", () => {});
    // One child plus parent. Only the child's executed handshake permits readiness.
    let ready = false;
    Bun.spawn([process.execPath, "--no-env-file", "-e", "process.on('SIGTERM', () => {}); process.send('started'); setInterval(() => {}, 1000)"], {
      stdout: "ignore", stderr: "ignore",
      ipc(message) {
        check(message === "started" && !ready);
        ready = true;
        process.stdout.write("rfc002-cancel-child-ready\n");
      },
    });
    setInterval(() => {}, 1000);
  } else {
    const own = text("/input/canary");
    const foreign = text("/input/foreign-marker");
    const host = text("/input/host-marker");
    check(own.length > 20 && own === process.env.FIXTURE_TOKEN && own !== foreign && own !== host);
    const foreignPath = text("/input/foreign-path"), hostPath = text("/input/host-path");
    for (const path of [foreignPath, hostPath, `/input/..${foreignPath}`, "/foreign/canary", "/fake-host/canary", "/input/../foreign/canary", "/input/escape", "/input/chain"] ) {
      let denied = false;
      try { text(path); } catch { denied = true; }
      check(denied);
    }
    for (const path of ["/input/canary", "/etc/rfc002-probe"]) {
      let denied = false;
      try { writeFileSync(path, "synthetic"); } catch { denied = true; }
      check(denied);
    }
    check(!Object.values(process.env).some(v => v?.includes(foreign) || v?.includes(host)));
    check(!existsSync("/scratch/previous"));
    writeFileSync("/scratch/previous", "synthetic");
    const target = Number(text("/input/foreign-pid"));
    check(Number.isSafeInteger(target) && target > 1 && !existsSync(`/proc/${target}`));
    let denied = false;
    try { process.kill(target, "SIGUSR1"); } catch (error) { denied = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    check(denied);
    // Inspect only this synthetic namespace. No host or unrelated PID is ever signalled.
    for (const pid of readdirSync("/proc").filter(p => /^\d+$/.test(p))) {
      for (const name of ["environ", "cmdline"]) {
        const value = text(`/proc/${pid}/${name}`);
        check(!value.includes(foreign) && !value.includes(host));
      }
    }
    for (const fd of readdirSync("/proc/self/fd")) {
      try {
        const link = (await import("node:fs")).readlinkSync(`/proc/self/fd/${fd}`);
        check(!link.includes(foreignPath) && !link.includes(hostPath) && !link.includes("/foreign/") && !link.includes("/fake-host/"));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" });
    check(await child.exited === 0);
    let full = false;
    try { writeFileSync("/scratch/full", Buffer.alloc(17 * 1024 * 1024)); }
    catch (error) { full = (error as NodeJS.ErrnoException).code === "ENOSPC"; }
    check(full);
    process.stdout.write("ok");
  }
} else process.exit(23);
