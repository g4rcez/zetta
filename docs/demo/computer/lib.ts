// Shared by seed.ts and record.ts: where the demo stack lives and how to reach it.
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const KIT = import.meta.dir;
export const REPO = resolve(KIT, "../../..");
/** Everything the stack writes (logs, state, videos). stack.sh uses the same folder. */
export const DEMO = process.env.ZETTA_DEMO_DIR ?? join(process.env.TMPDIR ?? tmpdir(), "zetta-demo-computer");
export const WEB_PORT = Number(process.env.ZETTA_DEMO_WEB_PORT ?? 3056);
export const API_PORT = Number(process.env.ZETTA_DEMO_API_PORT ?? 3077);
/** The browser only talks to the web dev server (HTTPS, self-signed); it forwards /api to the API. */
export const ORIGIN = `https://localhost:${WEB_PORT}`;
export const STATE = join(DEMO, "state.json");

/** Throwaway values stack.sh made for this run. */
export function secrets(): { setupKey: string; password: string } {
  const file = join(DEMO, "secrets.json");
  if (!existsSync(file)) throw new Error(`${file} is missing: run docs/demo/computer/stack.sh up first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** playwright-core is already in node_modules as a dependency of the tooling; the demo adds no dependency of its own. */
export async function loadChromium() {
  // `dot: true`: the store folder is named .bun. The last name in sorted order is the newest version.
  const entry = [
    ...new Bun.Glob("node_modules/.bun/playwright-core@*/node_modules/playwright-core/index.mjs").scanSync({ cwd: REPO, dot: true }),
  ]
    .sort()
    .at(-1);
  if (!entry) throw new Error("playwright-core is not installed in node_modules");
  const { chromium } = (await import(join(REPO, entry))) as typeof import("playwright-core");
  return chromium;
}

export const browserOptions = { ignoreHTTPSErrors: true, viewport: { width: 1360, height: 800 } } as const;
