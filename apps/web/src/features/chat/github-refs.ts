type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const REPO = "[A-Za-z0-9_.-]{1,100}";
/** `owner/repo#12`, `#12`, or a commit id. A match is never part of a longer word, path or URL. */
const REF = new RegExp(
  `(?<![\\p{L}\\p{N}_/.@#-])(?:(?<owner>${OWNER})/(?<repo>${REPO})#(?<qn>\\d{1,7})|#(?<n>\\d{1,7})|(?<sha>[0-9a-f]{7,40}))(?![\\p{L}\\p{N}_-])`,
  "gu",
);
const GITHUB_URL = new RegExp(
  `^https://github\\.com/(${OWNER})/(${REPO})/(issues|pull|commit)/(\\d{1,7}|[0-9a-f]{7,40})/?$`,
);
const GITHUB_REPO_URL = new RegExp(
  `^https://github\\.com/(${OWNER})/(${REPO})/(?:issues|pull|commit)/`,
);
/** Elements whose text stays as written. Links and inline code are decided one by one. */
const SKIP = new Set(["pre", "gh-ref", "bot-tag"]);

export type RefPart = { text: string; href?: undefined } | { text: string; href: string };

const commitUrl = (repo: string, sha: string) => `https://github.com/${repo}/commit/${sha}`;
// GitHub sends an issue address to the pull request when the number is one.
const issueUrl = (repo: string, n: string) => `https://github.com/${repo}/issues/${n}`;

/**
 * Splits `text` where it names a GitHub issue, pull request or commit: `owner/repo#12` always, `#12` and a commit id (7-40 hex
 * characters with a digit and a letter) when `repo` (`owner/repo`) says where they live. Returns `undefined` when nothing matches.
 */
export function splitGithubRefs(text: string, repo?: string): RefPart[] | undefined {
  const parts: RefPart[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    const g = m.groups!;
    let href: string | undefined;
    if (g.qn) href = issueUrl(`${g.owner}/${g.repo}`, g.qn);
    else if (repo && g.n) href = issueUrl(repo, g.n);
    else if (repo && g.sha && /\d/.test(g.sha) && /[a-f]/.test(g.sha))
      href = commitUrl(repo, g.sha);
    if (!href) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], href });
    last = m.index + m[0].length;
  }
  if (!parts.length) return undefined;
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A bare GitHub issue, pull request or commit address, as a short label (`owner/repo#48`, `owner/repo@a1b2c3d`) and its canonical address. */
export function shortenGithubUrl(url: string): { label: string; href: string } | undefined {
  const m = GITHUB_URL.exec(url);
  if (!m) return undefined;
  const [, owner, repo, kind, id] = m as unknown as [string, string, string, string, string];
  const slug = `${owner}/${repo}`;
  if (kind === "commit")
    return /^[0-9a-f]{7,40}$/.test(id)
      ? { label: `${slug}@${id.slice(0, 7)}`, href: commitUrl(slug, id) }
      : undefined;
  return /^\d+$/.test(id)
    ? { label: `${slug}#${id}`, href: `https://github.com/${slug}/${kind}/${id}` }
    : undefined;
}

/** The first repository a GitHub issue, pull request or commit link in the tree points to. */
function repoInTree(node: Node): string | undefined {
  const href = node.tagName === "a" ? node.properties?.href : undefined;
  const m = typeof href === "string" ? GITHUB_REPO_URL.exec(href) : null;
  if (m) return `${m[1]}/${m[2]}`;
  for (const c of node.children ?? []) {
    const r = repoInTree(c);
    if (r) return r;
  }
  return undefined;
}

const ref = (label: string, href: string): Node => ({
  type: "element",
  tagName: "gh-ref",
  properties: { dataHref: href },
  children: [{ type: "text", value: label }],
});
const onlyText = (n: Node) =>
  n.children?.length === 1 && n.children[0]!.type === "text" ? n.children[0]!.value : undefined;

/**
 * A rehype plugin that turns GitHub references of a reply into `<gh-ref>` elements (drawn as links by the Response): references in
 * the text, inline code that is only a reference, and links whose text is their own GitHub address. `repo` is where `#12` and commit
 * ids live; without it the first GitHub link of the reply is used.
 */
export const rehypeGithubRefs = (repo?: string) => () => (tree: Node) => {
  const where = repo ?? repoInTree(tree);
  const walk = (node: Node) => {
    if (!node.children || (node.tagName && SKIP.has(node.tagName))) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text") {
        const parts = splitGithubRefs(child.value ?? "", where);
        return parts
          ? parts.map<Node>((p) => (p.href ? ref(p.text, p.href) : { type: "text", value: p.text }))
          : [child];
      }
      if (child.tagName === "a") {
        const href = child.properties?.href;
        const short =
          typeof href === "string" && onlyText(child) === href ? shortenGithubUrl(href) : undefined;
        return short ? [ref(short.label, short.href)] : [child];
      }
      if (child.tagName === "code") {
        const text = onlyText(child)?.trim();
        const parts = text ? splitGithubRefs(text, where) : undefined;
        const only = parts?.length === 1 ? parts[0] : undefined;
        return only?.href ? [ref(text!, only.href)] : [child];
      }
      walk(child);
      return [child];
    });
  };
  walk(tree);
};

/**
 * The repository each row's references point to: the one its own reply recorded (`meta.repos`), else the latest one recorded
 * earlier in the log. Rows before any record have none.
 */
export function repoByRow(
  rows: readonly { id: string; meta?: { repos?: string[] | undefined } | null | undefined }[],
) {
  const out = new Map<string, string>();
  let last: string | undefined;
  for (const r of rows) {
    last = r.meta?.repos?.[0] ?? last;
    if (last) out.set(r.id, last);
  }
  return out;
}
