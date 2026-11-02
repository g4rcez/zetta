import { field } from "../bot-claude/host-skills";
import { LIMITS, noInjection, skillName } from "../bot-claude/profile";
import { looksSecret } from "../features/safety";
import { SUGGESTIONS, type Suggestion, type Trust } from "./suggestions";

export class MarketError extends Error {
  constructor(
    readonly code:
      | "INVALID_SOURCE"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "UNAVAILABLE"
      | "UNINSTALLABLE",
  ) {
    super(code);
  }
}

/** A place to look for skills on GitHub. `skill` is a folder name (the skills.sh form `owner/repo/skill`); `path` a folder in the repo. */
export type Source = { owner: string; repo: string; ref?: string; path?: string; skill?: string };

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._ -]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const SKILL_FILE = /(^|\/)SKILL\.md$/;

/**
 * Reads what a person pastes: `owner/repo`, `owner/repo/skill`, a github.com link (`/tree/<ref>/<folder>` or `/blob/<ref>/<folder>/SKILL.md`)
 * or a skills.sh link. Anything else, including a link to another site, gives undefined.
 */
export function parseSource(text: string): Source | undefined {
  const trimmed = text
    .trim()
    .split(/[?#]/)[0]!
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const link = /^(?:https?:\/\/)?(?:www\.)?([a-z.]+)\/(.+)$/i.exec(trimmed);
  const known = link && ["github.com", "skills.sh"].includes(link[1]!.toLowerCase());
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !known) return undefined;
  if (link && !known && /\.[a-z]{2,}$/i.test(link[1]!)) return undefined;
  const host = known ? link![1]!.toLowerCase() : "";
  const parts = (known ? link![2]! : trimmed).split("/").filter(Boolean);
  const [owner, repo, ...rest] = parts;
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo)) return undefined;
  const base: Source = { owner, repo };
  if (host === "github.com" && (rest[0] === "tree" || rest[0] === "blob")) {
    const [, ref, ...path] = rest;
    if (!ref || !SEGMENT.test(ref) || !path.every((p) => SEGMENT.test(p))) return undefined;
    const folder = SKILL_FILE.test(path.join("/")) ? path.slice(0, -1) : path;
    return { ...base, ref, ...(folder.length ? { path: folder.join("/") } : {}) };
  }
  if (rest.length === 0) return base;
  if (rest.length === 1 && SEGMENT.test(rest[0]!)) return { ...base, skill: rest[0]! };
  return undefined;
}

export type SkillWarning =
  | "empty"
  | "too_large"
  | "shell_injection"
  | "looks_secret"
  | "invalid_name";
/** What a SKILL.md would install as. Any warning stops the install. */
export type Preview = {
  repo: string;
  path: string;
  ref: string;
  name: string;
  description: string;
  body: string;
  warnings: SkillWarning[];
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

/** The skill a SKILL.md holds. The folder name is the id (as in skills.sh); the `name` in the frontmatter is used only when the folder has no usable name. */
export function readSkill(text: string, folder: string, truncated = false) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  const body = (m ? m[2]! : text).trim();
  const head = m?.[1] ?? "";
  const description = (field(head, "description") || (body.split(/\r?\n/)[0] ?? "")).slice(
    0,
    LIMITS.description,
  );
  const name =
    [folder, slug(field(head, "name"))].find((n) => skillName.safeParse(n).success) ?? "";
  const warnings: SkillWarning[] = [
    ...(body ? [] : (["empty"] as const)),
    ...(truncated || body.length > LIMITS.body ? (["too_large"] as const) : []),
    ...(noInjection(body) ? [] : (["shell_injection"] as const)),
    ...(looksSecret(`${name}\n${description}\n${body}`) ? (["looks_secret"] as const) : []),
    ...(name ? [] : (["invalid_name"] as const)),
  ];
  return { name, description, body, warnings };
}

const HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;
const MAX_TREE_BYTES = 4_000_000;
const MAX_FILE_BYTES = 200_000;
const MAX_SKILLS = 300;
const MAX_DESCRIBE = 200;
const DESCRIBE_PARALLEL = 8;
const INDEX_PARALLEL = 3;
const INDEX_TTL_MS = 60 * 60_000;
const RETRY_MS = 60_000;
const SEARCH_WAIT_MS = 12_000;
const MAX_RESULTS = 50;

/**
 * Reads skills from GitHub. Only two fixed GitHub hosts are ever contacted, never an address a person typed, so there is nothing to
 * redirect inward. Answers are kept for a few minutes: GitHub allows 60 unauthenticated API calls an hour, shared by every person here.
 */
export function createMarket({
  fetch: doFetch = fetch,
  suggestions = SUGGESTIONS,
}: { fetch?: typeof fetch; suggestions?: readonly Suggestion[] } = {}) {
  const cache = new Map<string, { at: number; value: unknown }>();
  async function cached<T>(key: string, load: () => Promise<T>, ttl = TTL_MS): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as T;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return value;
  }

  async function get(url: string, max: number, accept?: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) throw new MarketError("UNAVAILABLE");
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "zetta", ...(accept ? { accept } : {}) },
      });
    } catch {
      throw new MarketError("UNAVAILABLE");
    }
    if (res.status === 404) throw new MarketError("NOT_FOUND");
    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
    )
      throw new MarketError("RATE_LIMITED");
    if (!res.ok || !res.body) throw new MarketError("UNAVAILABLE");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), truncated };
  }

  /** The commit a skill is read at. Everything after this uses the commit, so what is previewed is what is installed. */
  async function commit(src: Pick<Source, "owner" | "repo" | "ref">) {
    const url = `https://api.github.com/repos/${src.owner}/${src.repo}/commits/${encodeURIComponent(src.ref ?? "HEAD")}`;
    const { text } = await cached(url, () => get(url, 200, "application/vnd.github.sha"));
    const sha = text.trim();
    if (!SHA.test(sha)) throw new MarketError("UNAVAILABLE");
    return sha;
  }

  /** The SKILL.md files of a repository, newest commit of the ref (default branch when none). */
  async function list(src: Source) {
    const ref = await commit(src);
    const url = `https://api.github.com/repos/${src.owner}/${src.repo}/git/trees/${ref}?recursive=1`;
    const { text, truncated } = await cached(url, () => get(url, MAX_TREE_BYTES));
    type Tree = { tree?: { path: string; type: string }[]; truncated?: boolean };
    let parsed: Tree;
    try {
      parsed = JSON.parse(text) as Tree;
    } catch {
      throw new MarketError("UNAVAILABLE");
    }
    if (!Array.isArray(parsed.tree)) throw new MarketError("UNAVAILABLE");
    const inFolder = (dir: string) =>
      !src.path || dir === src.path || dir.startsWith(`${src.path}/`);
    const skills = parsed.tree
      .filter((t) => t.type === "blob" && SKILL_FILE.test(t.path))
      .map((t) => {
        const dir = t.path.split("/").slice(0, -1);
        return { name: dir.at(-1) ?? src.repo, path: t.path, dir: dir.join("/") };
      })
      .filter(
        (k) =>
          !k.path.split("/").includes("node_modules") &&
          inFolder(k.dir) &&
          (!src.skill || k.name === src.skill),
      )
      .slice(0, MAX_SKILLS)
      .map(({ name, path }) => ({ name, path }));
    return {
      repo: `${src.owner}/${src.repo}`,
      ref,
      skills,
      truncated: truncated || Boolean(parsed.truncated),
    };
  }

  const rawUrl = (src: Pick<Source, "owner" | "repo">, sha: string, path: string) =>
    `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;

  /** What `path` (a SKILL.md) of the repository would install as, read at commit `sha`. */
  async function preview(
    src: Pick<Source, "owner" | "repo">,
    path: string,
    sha: string,
  ): Promise<Preview> {
    if (!SHA.test(sha) || !SKILL_FILE.test(path) || !path.split("/").every((p) => SEGMENT.test(p)))
      throw new MarketError("INVALID_SOURCE");
    const url = rawUrl(src, sha, path);
    const { text, truncated } = await cached(url, () => get(url, MAX_FILE_BYTES));
    const folder = path.split("/").slice(0, -1).at(-1) ?? src.repo;
    const skill = readSkill(text, folder, truncated);
    return { repo: `${src.owner}/${src.repo}`, path, ref: sha, ...skill };
  }

  type Described = { name: string; path: string; description: string; warnings: SkillWarning[] };
  /** What each SKILL.md says, a few files at a time. A file that cannot be read is left out: it could not be installed either. */
  async function describe(
    src: Pick<Source, "owner" | "repo">,
    ref: string,
    paths: string[],
  ): Promise<Described[]> {
    const queue = paths.slice(0, MAX_DESCRIBE);
    const out = new Map<string, Described>();
    const worker = async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        try {
          const { text, truncated } = await get(rawUrl(src, ref, path), MAX_FILE_BYTES);
          const folder = path.split("/").slice(0, -1).at(-1) ?? src.repo;
          const { name, description, warnings } = readSkill(text, folder, truncated);
          out.set(path, { name: name || folder, path, description, warnings });
        } catch {
          // Left out of the list.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(DESCRIBE_PARALLEL, queue.length) }, worker));
    return paths.flatMap((p) => out.get(p) ?? []);
  }

  /** A repository's skills with what each one says it does, so a person can choose. Kept for an hour: a commit never changes. */
  async function described(src: Source) {
    const found = await list(src);
    const key = `described:${found.repo}@${found.ref}:${src.path ?? ""}:${src.skill ?? ""}`;
    const skills = await cached(
      key,
      () =>
        describe(
          src,
          found.ref,
          found.skills.map((k) => k.path),
        ),
      INDEX_TTL_MS,
    );
    return { ...found, skills };
  }

  type Entry = Described & { repo: string; ref: string; trust: Trust };
  let index:
    | { at: number; skills: Entry[]; unavailable: string[]; building: Promise<void> | undefined }
    | undefined;
  /** Reads the skills of every suggested repository, three at a time, in the background of the first search; kept for an hour. */
  function ensureIndex() {
    const ttl = index?.unavailable.length ? RETRY_MS : INDEX_TTL_MS;
    if (index && (index.building || Date.now() - index.at < ttl)) return index;
    const state = {
      at: Date.now(),
      skills: [] as Entry[],
      unavailable: [] as string[],
      building: undefined as Promise<void> | undefined,
    };
    const queue = [...suggestions];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const src = parseSource(s.repo);
        try {
          if (!src) throw new MarketError("INVALID_SOURCE");
          const d = await described(src);
          state.skills.push(
            ...d.skills.map((k) => ({ ...k, repo: d.repo, ref: d.ref, trust: s.trust })),
          );
        } catch {
          state.unavailable.push(s.repo);
        }
      }
    };
    state.building = Promise.all(Array.from({ length: INDEX_PARALLEL }, worker)).then(() => {
      state.at = Date.now();
      state.building = undefined;
    });
    index = state;
    return state;
  }

  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  /** Lower is better: a name that is the word, starts with it, contains it, or only the description or path has it. */
  const rank = (e: Entry, term: string) => {
    const name = plain(e.name);
    if (name === term) return 0;
    if (name.startsWith(term)) return 1;
    if (name.includes(term)) return 2;
    return plain(`${e.description} ${e.path} ${e.repo}`).includes(term) ? 3 : undefined;
  };

  return {
    list,
    preview,
    described,
    /** Which trust level a repository has on the suggestions list, or null when it is not on it. */
    trust: (repo: string): Trust | null =>
      suggestions.find((s) => s.repo.toLowerCase() === repo.toLowerCase())?.trust ?? null,
    suggestions: () => suggestions,
    /** Search over the suggested (trusted) repositories only. Every word must be found; `indexing` is true while some are still being read. */
    async search(query: string) {
      const terms = plain(query).split(" ").filter(Boolean);
      const state = ensureIndex();
      if (state.building) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          state.building,
          new Promise((resolve) => (timer = setTimeout(resolve, SEARCH_WAIT_MS))),
        ]);
        clearTimeout(timer);
      }
      const scored = state.skills.flatMap((e) => {
        const ranks = terms.map((t) => rank(e, t));
        return ranks.every((r) => r !== undefined)
          ? [{ e, score: ranks.reduce<number>((a, r) => a + (r ?? 0), 0) }]
          : [];
      });
      scored.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name));
      return {
        skills: scored.slice(0, MAX_RESULTS).map((x) => x.e),
        unavailable: [...state.unavailable],
        indexing: Boolean(state.building),
      };
    },
  };
}
export type Market = ReturnType<typeof createMarket>;
