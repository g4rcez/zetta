// Where the installation settings live now, in a real browser: Studio > Decisions keeps only the decision model; Studio > Voice holds speech
// to text and text to speech; the WhatsApp plugin page holds the shared WhatsApp server and the Bot e-mail address plugin page the operator's
// mail setup (administrators only); Studio > Server settings holds the update check. A member (a second account, invited) sees none of it.
//
//   bun scripts/e2e/studio-places.ts      (SHOTS=<folder> keeps the screenshots there)
//
// It starts everything itself and removes it all at the end:
//  - an isolated Zetta: the real API server on its own embedded Postgres (a throwaway folder, no container) and the web dev server, on
//    their own ports, with nothing read from apps/*/.env. It never touches a Zetta you run for yourself;
//  - Helium (headless, its own profile), driven by studio-places-browser.ts under Node.
//
// Needs: the embedded Postgres runtime (`bun run db:runtime`), the Helium browser (`PLACES_E2E_BROWSER` to use another Chromium binary),
// Node 24. A part this machine cannot do is written as `skip`, never as `pass`.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createReport } from "./report";

const REPO = resolve(import.meta.dir, "../..");
const BROWSER = process.env.PLACES_E2E_BROWSER || "/Applications/Helium.app/Contents/MacOS/Helium";
const report = createReport(
  "studio-places",
  "Studio places: Decisions, Voice, the WhatsApp and Bot e-mail address plugin pages and Server settings, for an administrator and a member",
);

const ACCOUNT_PASSWORD = `acct-${Math.random().toString(36).slice(2, 12)}-Aa1`;
const SETUP_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64");

const children: ChildProcess[] = [];
const cleanups: (() => Promise<void> | void)[] = [];
/**
 * Each child leads its own process group, and the whole group is signalled: `bun run vp dev` starts vite as a grandchild, which outlived a
 * signal sent to the wrapper alone and stayed behind as an orphan after every run.
 */
function signalGroups(signal: NodeJS.Signals) {
  for (const c of children) {
    if (!c.pid) continue;
    try {
      process.kill(-c.pid, signal);
    } catch {
      // Not a group leader, or the group is already gone: signal the child itself.
      if (c.exitCode === null) c.kill(signal);
    }
  }
}
async function cleanup() {
  signalGroups("SIGTERM");
  await Bun.sleep(1500);
  signalGroups("SIGKILL");
  for (const f of cleanups.reverse()) await Promise.resolve(f()).catch(() => undefined);
}
// SIGTERM too: `timeout` ends a run with it, and without a handler nothing was stopped.
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));
process.on("SIGTERM", () => void cleanup().then(() => process.exit(143)));

async function main() {
  if (!existsSync(BROWSER))
    return report.skip("whole run", `no browser at ${BROWSER}: set PLACES_E2E_BROWSER`);
  const runtime = [
    ...new Bun.Glob("packages/db/.pg-runtime/*.tar.zst").scanSync({ cwd: REPO, dot: true }),
  ];
  if (!runtime.length)
    return report.skip("whole run", "no embedded Postgres runtime: run `bun run db:runtime`");
  const playwright = [
    ...new Bun.Glob(
      "node_modules/.bun/playwright-core@*/node_modules/playwright-core/index.mjs",
    ).scanSync({ cwd: REPO, dot: true }),
  ]
    .sort()
    .at(-1);
  if (!playwright) return report.skip("whole run", "playwright-core is not in node_modules");

  const { freePort } =
    await import("../../apps/server/src/modules/integrations/plugins/vault/vault-real-setup");

  // The scratch folder is short: the embedded Postgres keeps its unix socket in it.
  const dir = mkdtempSync("/tmp/zplc-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const shots = process.env.SHOTS || join(process.env.TMPDIR || tmpdir(), "zetta-e2e-places-shots");
  mkdirSync(shots, { recursive: true });

  // ---- isolated Zetta: API on embedded Postgres, then the web dev server
  const webPort = freePort();
  const apiPort = freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  const home = join(dir, "pg");
  const server = join(dir, "server");
  const state = join(dir, "state");
  for (const d of [home, server, state]) mkdirSync(d, { recursive: true });
  writeFileSync(
    join(server, ".env.schema"),
    readFileSync(join(REPO, "apps/server/.env.schema"), "utf8")
      .split("\n")
      .filter((l) => !l.includes("generateTsTypes"))
      .join("\n"),
  );
  const base = {
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "e2e",
    PATH: process.env.PATH ?? "",
  };
  const spawnLogged = (
    name: string,
    cmd: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ) => {
    const log = Bun.file(join(dir, `${name}.log`)).writer();
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.stdout?.on("data", (d) => log.write(d));
    child.stderr?.on("data", (d) => log.write(d));
    children.push(child);
    return child;
  };
  spawnLogged(
    "server",
    process.execPath,
    ["--no-env-file", "run", join(REPO, "apps/server/src/index.ts")],
    server,
    {
      ...base,
      NODE_ENV: "development",
      PORT: String(apiPort),
      BETTER_AUTH_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(36))).toString(
        "base64",
      ),
      ZETTA_SERVER_URL: origin,
      ZETTA_HOME: home,
      ZETTA_CONNECTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64",
      ),
      ZETTA_SETUP_KEY: SETUP_KEY,
      ZETTA_DB_POOL_MAX: "10",
      ZETTA_EMBEDDING: "off",
      ZETTA_FILES_ROOT: join(state, "files"),
      ZETTA_VM_TOKEN_ROOT: join(state, "vm"),
      ZETTA_BROWSER_ROOT: join(state, "browser"),
      ZETTA_ARTIFACTS_ROOT: join(state, "artifacts"),
      ZETTA_ATTACHMENTS_ROOT: join(state, "attachments"),
      ZETTA_CODE_ROOT: join(state, "code"),
      ZETTA_CLAUDE_PLUGIN_ROOT: join(state, "plugins"),
    },
  );
  spawnLogged(
    "web",
    process.execPath,
    [
      "run",
      "vp",
      "dev",
      "--config",
      join(REPO, "docs/demo/computer/vite.demo.config.ts"),
      "--port",
      String(webPort),
      "--strictPort",
    ],
    join(REPO, "apps/web"),
    {
      ...base,
      NODE_ENV: "development",
      PORTLESS_URL: origin,
      ZETTA_SERVER_URL: origin,
      ZETTA_DEMO_WEB_PORT: String(webPort),
      ZETTA_DEMO_API_URL: `http://127.0.0.1:${apiPort}`,
      ZETTA_DEMO_VITE_CACHE: join(dir, "vite-cache"),
    },
  );
  const waitFor = async (url: string, what: string, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      if (
        await fetch(url).then(
          (r) => r.status > 0,
          () => false,
        )
      )
        return;
      await Bun.sleep(1000);
    }
    const log = (name: string) =>
      existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8").slice(-1500) : "(no log)";
    throw new Error(
      `${what} did not answer on ${url} in ${seconds}s.\nserver.log: ${log("server.log")}\nweb.log: ${log("web.log")}`,
    );
  };
  await waitFor(`http://127.0.0.1:${apiPort}/`, "the API server", 120);
  await waitFor(`${origin}/`, "the web app", 120);
  // The first load compiles the app: warm it so the browser steps do not wait on the dependency optimizer.
  await fetch(`${origin}/src/main.tsx`).catch(() => undefined);

  // ---- the browser
  const cdpPort = freePort();
  const profile = join(dir, "profile");
  const browserProc = spawn(
    BROWSER,
    [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--disable-http2",
      // Less memory on a machine that is short of it: the tab crashed under swap pressure in earlier runs.
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  children.push(browserProc);
  await waitFor(`http://127.0.0.1:${cdpPort}/json/version`, "the browser", 30);

  const driver = spawn("node", [join(REPO, "scripts/e2e/studio-places-browser.ts")], {
    env: {
      ...base,
      PLACES_E2E_ORIGIN: origin,
      PLACES_E2E_SHOTS: shots,
      PLACES_E2E_CDP: `http://127.0.0.1:${cdpPort}`,
      PLACES_E2E_ACCOUNT_PASSWORD: ACCOUNT_PASSWORD,
      PLACES_E2E_SETUP_KEY: SETUP_KEY,
      PLACES_E2E_PLAYWRIGHT: join(REPO, playwright),
    },
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  children.push(driver);
  let buffer = "";
  let done = false;
  driver.stdout?.on("data", (d: Buffer) => {
    buffer += d.toString();
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("RESULT ")) {
        const r = JSON.parse(line.slice(7)) as {
          name: string;
          result: "pass" | "fail" | "skip";
          detail: string;
        };
        report[r.result](r.name, r.detail);
      } else if (line.startsWith("SHOT ")) console.log(line);
      else if (line === "DONE") done = true;
      else if (line.trim()) console.log(`[driver] ${line}`);
    }
  });
  const code = await new Promise<number | null>((r) => driver.on("exit", r));
  if (!done) report.fail("browser driver finished", `exit code ${code}; see the log above`);
  report.note(`screenshots are in ${shots}`);
}

try {
  await main();
} catch (e) {
  report.fail("run", e instanceof Error ? e.message : String(e));
} finally {
  await cleanup();
  process.exit(report.finish("the embedded Postgres runtime, Helium, Node 24"));
}
