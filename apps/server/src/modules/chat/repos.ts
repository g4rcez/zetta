import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_DIRS = 50;
const MAX_REPOS = 5;
/** Files git rewrites when a repository is cloned, fetched, committed to or switched. */
const ACTIVITY = ["logs/HEAD", "index", "FETCH_HEAD"] as const;

/**
 * `owner/repo` of a github.com remote URL (https, ssh or scp style). Only the name is kept: the URL may carry a token.
 * Returns `undefined` for any other host.
 */
export function githubRepoOf(url: string): string | undefined {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const originOf = (config: string) => /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(config)?.[1];

/**
 * The GitHub repositories (`owner/repo`) in a user's code workspace that a run touched: the clone is one folder level down, and
 * git activity inside it at or after `since` (ms) counts. Reads files only, never runs git. At most 5, most recent first.
 */
export async function touchedRepos(workspace: string, since: number): Promise<string[]> {
  const dirs = await readdir(workspace, { withFileTypes: true }).catch(() => []);
  const hits: { repo: string; at: number }[] = [];
  for (const d of dirs.filter((x) => x.isDirectory()).slice(0, MAX_DIRS)) {
    const git = join(workspace, d.name, ".git");
    const times = await Promise.all(
      ACTIVITY.map((f) =>
        stat(join(git, f)).then(
          (s) => s.mtimeMs,
          () => 0,
        ),
      ),
    );
    const at = Math.max(...times);
    if (at < since) continue;
    const repo = githubRepoOf(
      originOf(await readFile(join(git, "config"), "utf8").catch(() => "")) ?? "",
    );
    if (repo) hits.push({ repo, at });
  }
  return [...new Set(hits.sort((a, b) => b.at - a.at).map((h) => h.repo))].slice(0, MAX_REPOS);
}
