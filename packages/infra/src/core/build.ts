// The local half of a deploy. The server has one core, so a release is built here: from a commit, in a clean folder, so work that is
// not committed and local `.env` files never ship.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** What the upload leaves out. Every workspace keeps its package.json, which the lockfile needs. The landing page is not deployed. */
export const UPLOAD_FILTERS = [
  "--include=/apps/landing/package.json",
  "--exclude=/apps/landing/*",
  "--exclude=/docs/demo",
  "--exclude=node_modules",
];

export type Commit = { id: string; date: string };

export async function output(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`Failed: ${command.join(" ")}`);
  return text.trim();
}

export async function resolveCommit(root: string, ref: string): Promise<Commit> {
  if (ref.startsWith("-")) throw new Error(`"${ref}" is not a git ref.`);
  const id = await output(["git", "rev-parse", "--verify", `${ref}^{commit}`], root);
  const date = await output(["git", "show", "--no-patch", "--format=%cI", id], root);
  return { id, date };
}

export const hasUncommittedWork = async (root: string) =>
  (await output(["git", "status", "--porcelain"], root)) !== "";

export function releaseName(now: Date, commit: string) {
  const stamp = now.toISOString().replaceAll(/[-:]/g, "").slice(0, 15);
  return `${stamp}Z-${commit.slice(0, 12)}`;
}

/** The shell's environment without anything of this machine's Zetta, so only the values given here reach the build. */
export function buildEnvironment(
  extra: Record<string, string>,
  from: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const own = /^(ZETTA_|DEPLOY_|VITE_|_{0,2}VARLOCK)|^(DATABASE_URL|BETTER_AUTH_SECRET|NODE_ENV)$/;
  const kept = Object.entries(from).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !own.test(entry[0]),
  );
  return { ...Object.fromEntries(kept), ...extra };
}

export async function buildRelease(options: { root: string; commit: Commit; serverUrl: string }) {
  const folder = mkdtempSync(join(tmpdir(), "zetta-release-"));
  const source = join(folder, "source");
  const remove = () => rmSync(folder, { recursive: true, force: true });
  // The build runs with the Bun that runs this program. Inside the compiled binary that is the binary itself, which acts as Bun when
  // BUN_BE_BUN is set; the link gives the package scripts a `bun` to call, so no Bun has to be installed on this computer.
  const tools = join(folder, "bin");
  const run = async (command: string[], cwd: string, extra: Record<string, string> = {}) => {
    const env = buildEnvironment({ ...extra, BUN_BE_BUN: "1" });
    env.PATH = [tools, env.PATH].filter(Boolean).join(delimiter);
    const child = Bun.spawn(command, {
      cwd,
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error(`Failed: ${command.join(" ")}`);
  };
  try {
    mkdirSync(tools);
    symlinkSync(process.execPath, join(tools, "bun"));
    const archive = join(folder, "source.tar");
    await run(["git", "archive", "--format=tar", "-o", archive, options.commit.id], options.root);
    await run(["mkdir", source], folder);
    await run(["tar", "-xf", archive, "-C", source], folder);
    await run([process.execPath, "install", "--frozen-lockfile"], source);
    const production = { NODE_ENV: "production", ZETTA_SERVER_URL: options.serverUrl };
    await run([process.execPath, "run", "build"], join(source, "apps/server"), production);
    await run([process.execPath, "run", "build"], join(source, "apps/web"), production);
    // Read by the unit: the server has no .git, so this is how it knows which version it is.
    writeFileSync(
      join(source, "release.env"),
      `ZETTA_BUILD_COMMIT=${options.commit.id.slice(0, 7)}\nZETTA_BUILD_DATE=${options.commit.date}\n`,
    );
    return { source, remove };
  } catch (error) {
    remove();
    throw error;
  }
}
