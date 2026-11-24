// The web dev server must run on Node. `bun run` (root bunfig `[run] bun = true`) puts a `node` -> bun shim first in PATH, so `vp dev` would
// start Vite on Bun, and on Bun (before 1.4) a WebSocket through the /api proxy never opens (oven-sh/bun#10441): voice calls and any other
// socket the app opens fail in development. This script drops the shim from PATH and starts `vp dev` with the real Node.
import { spawn } from "node:child_process";
import { delimiter } from "node:path";

const shim = /[\\/]bun-node-[^\\/]*$/;
const PATH = (process.env.PATH ?? "")
  .split(delimiter)
  .filter((dir) => !shim.test(dir))
  .join(delimiter);

const windows = process.platform === "win32";
// Its own process group: `vp` starts Vite as a child and does not pass a SIGTERM on, so only signalling the whole group stops Vite too
// (otherwise it stays on :3000 and the next start fails on the taken port).
const child = spawn("vp", ["dev", ...process.argv.slice(2)], {
  env: { ...process.env, PATH },
  shell: windows,
  stdio: "inherit",
  detached: !windows,
});
const stop = (signal: NodeJS.Signals) => {
  try {
    if (!windows && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => stop(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
