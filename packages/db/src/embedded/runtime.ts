// Unpacks the Postgres runtime archive (Postgres + unaccent + pgvector) into the data folder, once per runtime version.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { archiveName, type EmbeddedLayout, RUNTIME_VERSION } from "./paths";

const MARKER = ".zetta-runtime";
const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

export type Runtime = { postgres: string; initdb: string; pgCtl: string };

export const runtimeBinaries = (folder: string): Runtime => ({
  postgres: join(folder, "bin", exe("postgres")),
  initdb: join(folder, "bin", exe("initdb")),
  pgCtl: join(folder, "bin", exe("pg_ctl")),
});

export const runtimeInstalled = (layout: EmbeddedLayout) =>
  existsSync(join(layout.runtime, MARKER));

/**
 * Makes sure the runtime is unpacked and returns its binaries. `archive` is a `.tar.zst` file: a path on disk in a checkout, or a file
 * embedded in the compiled binary.
 */
export async function ensureRuntime(layout: EmbeddedLayout, archive: string): Promise<Runtime> {
  if (runtimeInstalled(layout)) return runtimeBinaries(layout.runtime);
  const packed = Bun.file(archive);
  if (!(await packed.exists()))
    throw new Error(
      `No Postgres runtime for this computer (${archiveName()}). In a checkout, build it once with \`bun run db:runtime\`, or set DATABASE_URL to use your own Postgres.`,
    );

  // Unpack beside the final folder and rename, so a start that dies halfway never leaves a half runtime that looks complete.
  const staging = `${layout.runtime}.unpacking-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const tarball = join(staging, "runtime.tar");
  await Bun.write(tarball, Bun.zstdDecompressSync(await packed.bytes()));
  // The system `tar` (bsdtar on macOS and Windows, GNU tar on Linux) keeps file modes and symlinks.
  const unpack = Bun.spawnSync(["tar", "-xf", tarball, "-C", staging], { stderr: "pipe" });
  if (unpack.exitCode !== 0) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`Could not unpack the Postgres runtime: ${unpack.stderr.toString().trim()}`);
  }
  rmSync(tarball);
  writeFileSync(join(staging, MARKER), `${RUNTIME_VERSION}\n`);
  mkdirSync(dirname(layout.runtime), { recursive: true });
  rmSync(layout.runtime, { recursive: true, force: true });
  renameSync(staging, layout.runtime);
  return runtimeBinaries(layout.runtime);
}
