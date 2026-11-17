import { spawnSync } from "node:child_process";
import { dayOf, type BuildInfo } from "@zetta/core/update-check";

type Env = Record<string, string | undefined>;
/** Asks git for the commit and its date in the folder the server runs from. Returns the two lines `git log` printed, or undefined. */
type GitRead = () => string | undefined;

const COMMIT = /^[0-9a-f]{7,40}$/i;

/** Reads a commit and its date from two strings, or null when either is missing or malformed. The date becomes ISO 8601. */
export function parseBuild(commit: string | undefined, date: string | undefined): BuildInfo | null {
  const c = (commit ?? "").trim();
  const d = (date ?? "").trim();
  if (!COMMIT.test(c) || !dayOf(d)) return null;
  return { commit: c.slice(0, 12).toLowerCase(), date: new Date(Date.parse(d)).toISOString() };
}

/** In a source checkout the build is whatever git says is checked out. A failure of any kind means "no stamp", never an error. */
function readGit(): string | undefined {
  try {
    const r = spawnSync("git", ["log", "-1", "--format=%h%n%cI"], {
      cwd: import.meta.dir,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return r.status === 0 ? r.stdout : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What this server was built from: the commit and the date of that commit, or null when nobody stamped it. The installer sets
 * `ZETTA_BUILD_COMMIT` and `ZETTA_BUILD_DATE` as build arguments of the image (see install.sh and apps/server/Dockerfile). A source or
 * development checkout has no stamp and asks git instead. The image holds no `.git`, so an image built without the arguments is null.
 * A pure helper: the environment and the git call are arguments.
 */
export function buildInfo(env: Env = process.env, git: GitRead = readGit): BuildInfo | null {
  const stamped = parseBuild(env.ZETTA_BUILD_COMMIT, env.ZETTA_BUILD_DATE);
  if (stamped) return stamped;
  const [commit, date] = (git() ?? "").split("\n");
  return parseBuild(commit, date);
}

let cached: { value: BuildInfo | null } | undefined;
/** `buildInfo()` read once per process: the build does not change while the server runs. */
export function currentBuild(): BuildInfo | null {
  cached ??= { value: buildInfo() };
  return cached.value;
}
