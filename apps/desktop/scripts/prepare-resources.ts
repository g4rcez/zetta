// Stages everything the app ships to run its own server: the built server and the packages it still imports at run time, the built web app,
// the Postgres runtime archive for this platform, and every migration. Output: apps/desktop/.resources (git-ignored), which
// electrobun.config.ts copies into the app. Run by `bun run build`; `--skip-build` reuses what is already built.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { archiveName } from "../../../packages/db/src/embedded/paths";
import { migrationNames } from "../../../packages/db/src/embedded/migrate";

const here = import.meta.dir;
const root = join(here, "../../..");
const out = join(here, "..", ".resources");
const skipBuild = process.argv.includes("--skip-build");

const run = (command: string[], cwd: string, env: Record<string, string> = {}) => {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`failed (${result.exitCode}): ${command.join(" ")}`);
};

const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  workspaces?: { catalog?: Record<string, string> };
  catalog?: Record<string, string>;
};
const catalog = rootPackage.workspaces?.catalog ?? rootPackage.catalog ?? {};
const serverPackage = JSON.parse(readFileSync(join(root, "apps/server/package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

/**
 * Packages the app does not ship. The workspace ones are inside the built server already. The speech and embedding models (and their native
 * runtime, and the phonemizer of the local voice) are far larger than the rest together, and the server falls back to keyword search and off-by-default transcription without them;
 * the browser automation CLI downloads its own browser. A server on a computer that wants them is the Docker install.
 */
const NOT_SHIPPED = new Set(["@huggingface/transformers", "espeak-ng", "agent-browser"]);

const platformKey = `${process.platform}-${process.arch}`;
const archive = join(root, "packages/db/.pg-runtime", archiveName(platformKey));

if (!skipBuild) {
  run(["bun", "run", "build"], join(root, "apps/server"));
  // The web app talks to the server it is served from (apps/web/src/lib/server-origin.ts), so the address it is built with does not matter.
  run(["bun", "run", "build"], join(root, "apps/web"), {
    ZETTA_SERVER_URL: "http://127.0.0.1:3000",
  });
}
if (!existsSync(archive)) run(["bun", "run", "db:runtime"], root);
for (const needed of [
  join(root, "apps/server/dist/index.mjs"),
  join(root, "apps/web/dist/index.html"),
  archive,
])
  if (!existsSync(needed)) throw new Error(`missing: ${needed}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });
cpSync(join(root, "apps/server/dist"), join(out, "server/dist"), { recursive: true });
cpSync(join(root, "apps/server/.env.schema"), join(out, "server/.env.schema"));
cpSync(join(root, "apps/web/dist"), join(out, "web"), { recursive: true });
mkdirSync(join(out, "pg"), { recursive: true });
cpSync(archive, join(out, "pg", `pg-runtime-${platformKey}.tar.zst`));

// Every migration's name and SQL in one file (the snapshots next to them are most of the folder's size and are not needed to apply them).
const folder = join(root, "packages/db/src/migrations");
mkdirSync(join(out, "db"), { recursive: true });
writeFileSync(
  join(out, "db/migrations.json"),
  JSON.stringify(
    migrationNames(folder).map((name) => ({
      name,
      sql: readFileSync(join(folder, name, "migration.sql"), "utf8"),
    })),
  ),
);

// The packages the built server imports by name, at the versions this repository uses.
const dependencies: Record<string, string> = {};
for (const [name, version] of Object.entries(serverPackage.dependencies)) {
  if (version.startsWith("workspace:") || NOT_SHIPPED.has(name)) continue;
  dependencies[name] = version === "catalog:" ? (catalog[name] ?? "") : version;
  if (!dependencies[name]) throw new Error(`no version for ${name}`);
}
writeFileSync(
  join(out, "server/package.json"),
  JSON.stringify(
    { name: "zetta-server-runtime", private: true, type: "module", dependencies },
    null,
    2,
  ),
);
run(["bun", "install", "--production", "--no-save"], join(out, "server"));

const size = Bun.spawnSync(["du", "-sh", out]).stdout.toString().split("\t")[0];
console.log(`staged ${readdirSync(out).join(", ")} in ${out} (${size})`);
