// Builds the Postgres runtime archive that Zetta unpacks when DATABASE_URL is empty: Postgres 18 with unaccent, plus pgvector compiled
// against the same Postgres version. Run on the platform you build for: `bun run db:runtime` (root) or
// `bun scripts/pg-runtime.ts build [--arch arm64|x64] [--skip-check]` here. Needs a C compiler, make, perl, bison and flex.
//
// Postgres binaries come from the `@embedded-postgres/<platform>` npm packages (https://github.com/leinelissen/embedded-postgres), which
// repackage https://github.com/zonkyio/embedded-postgres-binaries. Every download is pinned by checksum.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Client } from "pg";

import {
  archiveName,
  embeddedLayout,
  PG_VERSION,
  PGVECTOR_VERSION,
  runtimePlatform,
} from "../src/embedded/paths";
import { ensureRuntime } from "../src/embedded/runtime";
import { startEmbedded } from "../src/embedded/supervisor";

const NPM_VERSION = "18.6.0-beta.19";
const BINARIES: Record<string, string> = {
  "darwin-arm64":
    "sha512-FHuiAR1sQUw8J6M+UVFlzd1D8oP4rlL+16Zgd1STqCCzWmO6dFjXBCEQ2I1JaGVQKOE85NlCjNNKuy8RiIrsqw==",
  "darwin-x64":
    "sha512-ipQDDcoc72moknp3QHP3sgj90/ZG6IqBhN9mdd1eOfBEwJUJXESfuoyNiTwUc4PoNDmnx51nRqQwzxoKMUwSTw==",
  "linux-x64":
    "sha512-U7sqNsI2M5OPAClnptT05bGSnos4IESgUesNytwvgXQ9L4GKY1mnJciXab6CE1pWm3Kes4/UrsZVJJZKBMFZbw==",
  "linux-arm64":
    "sha512-mDNZiZkT+Wyxh+BD8HH1n603ircuVLSbQT2bVQeC0D7vk7zPO+54RNRUuC7H0RyTlU6l4FxOxjE6D1Yun1JgMg==",
};
const POSTGRES_SOURCE = {
  url: `https://ftp.postgresql.org/pub/source/v${PG_VERSION}/postgresql-${PG_VERSION}.tar.bz2`,
  sha256: "555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f",
};
const PGVECTOR_SOURCE = {
  url: `https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz`,
  sha256: "cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85",
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const arch = flag("--arch") ?? process.arch;
const platform = runtimePlatform(process.platform, arch);
const output = join(import.meta.dir, "../.pg-runtime", archiveName(platform));

function sh(command: string[], cwd?: string) {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(
      `${command.slice(0, 3).join(" ")} failed:\n${result.stderr.toString().slice(-1500)}`,
    );
  return result.stdout.toString();
}

async function download(
  url: string,
  to: string,
  check: { sha256: string } | { integrity: string },
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const [algorithm, expected, encoding] =
    "sha256" in check
      ? (["sha256", check.sha256, "hex"] as const)
      : (["sha512", check.integrity.replace("sha512-", ""), "base64"] as const);
  const actual = createHash(algorithm).update(bytes).digest(encoding);
  if (actual !== expected) throw new Error(`${url}: checksum mismatch (got ${actual})`);
  await Bun.write(to, bytes);
}

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** npm cannot ship symlinks: the package lists them in a file and creates them at install. */
function hydrateSymlinks(packageRoot: string) {
  const manifest = join(packageRoot, "native", "pg-symlinks.json");
  if (!existsSync(manifest)) return;
  for (const { source, target } of JSON.parse(readFileSync(manifest, "utf8")) as {
    source: string;
    target: string;
  }[]) {
    const from = resolve(packageRoot, source);
    const to = resolve(packageRoot, target);
    if (!existsSync(to)) symlinkSync(relative(dirname(to), from), to);
  }
  rmSync(manifest);
}

/** The macOS package holds both architectures in every file: keep the one being built. */
function thin(folder: string) {
  const lipoArch = arch === "x64" ? "x86_64" : arch;
  for (const path of files(folder)) {
    if (lstatSync(path).isSymbolicLink()) continue;
    const info = Bun.spawnSync(["lipo", "-archs", path], { stdout: "pipe", stderr: "ignore" });
    if (info.exitCode === 0 && info.stdout.toString().trim().split(/\s+/).length > 1)
      sh(["lipo", "-thin", lipoArch, path, "-output", path]);
  }
}

/** The macOS package ships each library three times under its version aliases: keep one file and link the others to it. */
function dedupe(folder: string) {
  const seen = new Map<string, string>();
  const byLongestName = files(folder).sort((a, b) => basename(b).length - basename(a).length);
  for (const path of byLongestName) {
    if (lstatSync(path).isSymbolicLink()) continue;
    const key = `${dirname(path)}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    const original = seen.get(key);
    if (!original) {
      seen.set(key, path);
      continue;
    }
    rmSync(path);
    symlinkSync(basename(original), path);
  }
}

function compilePgvector(work: string, runtime: string) {
  const module = files(join(runtime, "lib")).find((path) => /[\\/]plpgsql\.(dylib|so)$/.test(path));
  const control = files(join(runtime, "share")).find((path) => path.endsWith("plpgsql.control"));
  if (!module || !control)
    throw new Error("The Postgres package has no plpgsql module: its layout changed.");
  const suffix = module.endsWith(".dylib") ? "dylib" : "so";

  // Only the headers are needed: configure, then generate the ones the build writes.
  const postgres = join(work, `postgresql-${PG_VERSION}`);
  sh(["./configure", "--without-icu", "--without-readline", "--without-zlib"], postgres);
  sh(["make", "-C", "src/backend", "generated-headers"], postgres);

  const vector = join(work, `pgvector-${PGVECTOR_VERSION}`);
  const sources = readdirSync(join(vector, "src"))
    .filter((name) => name.endsWith(".c"))
    .map((name) => join("src", name));
  const link =
    process.platform === "darwin"
      ? ["-arch", arch === "x64" ? "x86_64" : arch, "-bundle", "-undefined", "dynamic_lookup"]
      : ["-shared", "-fPIC"];
  sh(
    [
      process.env.CC ?? "cc",
      "-O2",
      "-ftree-vectorize",
      "-fassociative-math",
      "-fno-signed-zeros",
      "-fno-trapping-math",
      "-fno-strict-aliasing",
      "-fwrapv",
      "-fvisibility=hidden",
      `-I${join(postgres, "src", "include")}`,
      ...link,
      "-o",
      join(dirname(module), `vector.${suffix}`),
      ...sources,
    ],
    vector,
  );
  cpSync(join(vector, "vector.control"), join(dirname(control), "vector.control"));
  cpSync(
    join(vector, "sql", "vector.sql"),
    join(dirname(control), `vector--${PGVECTOR_VERSION}.sql`),
  );
}

/** Starts the packed archive the way the app does and checks what the migrations need. */
async function check(archive: string, work: string) {
  const layout = embeddedLayout(mkdtempSync(join(work, "check-")));
  const server = await startEmbedded(await ensureRuntime(layout, archive), layout);
  try {
    const client = new Client({ connectionString: server.url });
    await client.connect();
    await client.query("create extension vector; create extension unaccent;");
    const { rows } = await client.query(
      "select uuidv7() as id, unaccent('é') as plain, '[1,2,3]'::vector <=> '[1,2,4]'::vector as distance, version()",
    );
    await client.end();
    if (rows[0].plain !== "e" || !(rows[0].distance > 0))
      throw new Error(`Unexpected answers: ${JSON.stringify(rows[0])}`);
    console.log(`✓ ${rows[0].version}`);
  } finally {
    server.stop();
  }
}

async function build() {
  const integrity = BINARIES[platform];
  if (!integrity)
    throw new Error(
      `No pinned Postgres binaries for ${platform}. Supported: ${Object.keys(BINARIES).join(", ")}.`,
    );
  const work = mkdtempSync(join(tmpdir(), "zetta-pg-runtime-"));
  try {
    console.log(
      `▶ Downloading Postgres ${PG_VERSION} (${platform}), its source and pgvector ${PGVECTOR_VERSION}`,
    );
    await Promise.all([
      download(
        `https://registry.npmjs.org/@embedded-postgres/${platform}/-/${platform}-${NPM_VERSION}.tgz`,
        join(work, "binaries.tgz"),
        { integrity },
      ),
      download(POSTGRES_SOURCE.url, join(work, "postgres.tar.bz2"), POSTGRES_SOURCE),
      download(PGVECTOR_SOURCE.url, join(work, "pgvector.tar.gz"), PGVECTOR_SOURCE),
    ]);
    for (const name of ["binaries.tgz", "postgres.tar.bz2", "pgvector.tar.gz"])
      sh(["tar", "-xf", name], work);

    hydrateSymlinks(join(work, "package"));
    const runtime = join(work, "package", "native");
    if (process.platform === "darwin") {
      thin(runtime);
      dedupe(join(runtime, "lib"));
    }
    console.log("▶ Compiling pgvector");
    compilePgvector(work, runtime);

    console.log("▶ Packing");
    sh(["tar", "-cf", join(work, "runtime.tar"), "-C", runtime, "."]);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      Bun.zstdCompressSync(readFileSync(join(work, "runtime.tar")), { level: 19 }),
    );
    const megabytes = (lstatSync(output).size / 1024 / 1024).toFixed(1);

    if (args.includes("--skip-check") || arch !== process.arch)
      console.log("  (start check skipped)");
    else await check(output, work);
    console.log(`✓ ${relative(process.cwd(), output)} (${megabytes} MB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (args[0] !== "build") {
  console.error("Usage: bun scripts/pg-runtime.ts build [--arch arm64|x64] [--skip-check]");
  process.exit(2);
}
await build();
