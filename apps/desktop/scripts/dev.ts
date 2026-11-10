/**
 * `bun run dev:desktop`: the Zetta server, the Zetta web app and the desktop app, and nothing else (no landing page, no infra).
 *
 * The desktop app opens the web dev server it finds on https://localhost:3000 as a server called "Dev server", so the web app is up before the
 * app starts. The web dev server forwards /api to the API on http://127.0.0.1:6000. Process variables win over the .env files (varlock and
 * Vite), so a stale .env cannot point the pair at different addresses. Postgres is not started here: `bun run db:start`.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const desktop = join(root, "apps/desktop");
const ORIGIN = "https://localhost:3000";
const API_PORT = "6000";

const certs = ["../../.certs/localhost.pem", "../../.certs/localhost-key.pem"] as const;
// A mkcert pair (`bun run certs`) is trusted by the webview; without it Vite makes a self-signed certificate that the webview may refuse.
const trusted = certs.every((path) => existsSync(join(root, "apps/web", path)));

const children: Bun.Subprocess[] = [];
let stopping = false;

/** `vp` and `bunx` start the real processes one level down and do not pass a signal on, so a child leads its own process group and the group gets it. */
function end(child: Bun.Subprocess) {
  try {
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

function stop(code: number): never {
  if (!stopping) {
    stopping = true;
    for (const child of children) end(child);
  }
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function run(name: string, cmd: string[], cwd: string, env: Record<string, string>) {
  const child = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    detached: process.platform !== "win32",
  });
  children.push(child);
  void child.exited.then((code) => {
    if (stopping) return;
    console.error(`\n[dev:desktop] ${name} stopped (exit ${code}); stopping the rest.`);
    stop(code || 1);
  });
  return child;
}

async function listening(host: string, port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: host, port, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function waitFor(label: string, probe: () => Promise<boolean>, seconds = 90) {
  for (let waited = 0; waited < seconds; waited++) {
    if (await probe()) return;
    await Bun.sleep(1_000);
  }
  console.error(`[dev:desktop] ${label} did not come up in ${seconds}s.`);
  stop(1);
}

if (!trusted)
  console.warn(
    "[dev:desktop] No .certs pair: run `bun run certs` (needs mkcert) if the app shows a certificate error.",
  );

run("server", ["vp", "run", "--filter", "server", "dev:server"], root, {
  PORT: API_PORT,
  ZETTA_HOST: "127.0.0.1",
  BETTER_AUTH_URL: ORIGIN,
  CORS_ORIGIN: ORIGIN,
});
run("web", ["vp", "run", "--filter", "web", "dev"], root, {
  VITE_SERVER_URL: ORIGIN,
  ...(trusted ? { ZETTA_TLS_CERT: certs[0], ZETTA_TLS_KEY: certs[1] } : {}),
});

await waitFor("The web dev server", async () => {
  try {
    await fetch(ORIGIN, { method: "HEAD", tls: { rejectUnauthorized: false } });
    return true;
  } catch {
    return false;
  }
});
await waitFor("The API", () => listening("127.0.0.1", Number(API_PORT)));

console.log(`\n[dev:desktop] ${ORIGIN} is up. Starting the desktop app (it opens "Dev server").\n`);
run("desktop", ["bunx", "electrobun", "dev", "--watch"], desktop, {});
await new Promise(() => {});
