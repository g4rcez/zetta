import { describe, expect, it } from "bun:test";

import { repoByRow, rehypeGithubRefs, shortenGithubUrl, splitGithubRefs } from "./github-refs";

const show = (p: ReturnType<typeof splitGithubRefs>) =>
  p?.map((x) => (x.href ? `[${x.text}->${x.href}]` : x.text)).join("");

describe("splitGithubRefs", () => {
  it("links #47 and #48 to the repository it is told", () => {
    expect(show(splitGithubRefs("issue #47, PR #48.", "g4rcez/combi-keys"))).toBe(
      "issue [#47->https://github.com/g4rcez/combi-keys/issues/47], PR [#48->https://github.com/g4rcez/combi-keys/issues/48].",
    );
  });
  it("links owner/repo#47 with no repository known", () => {
    expect(show(splitGithubRefs("see acme/web#47 now"))).toBe(
      "see [acme/web#47->https://github.com/acme/web/issues/47] now",
    );
  });
  it("leaves a bare #47 alone when no repository is known", () => {
    expect(splitGithubRefs("issue #47")).toBeUndefined();
  });
  it("links a commit id", () => {
    expect(show(splitGithubRefs("fixed in a1b2c3d4", "acme/web"))).toBe(
      "fixed in [a1b2c3d4->https://github.com/acme/web/commit/a1b2c3d4]",
    );
  });
  it("does not link hex-looking words, numbers or UUID pieces", () => {
    expect(splitGithubRefs("deadbeef 1234567 a1b2c3d4-e5f6-7890", "acme/web")).toBeUndefined();
  });
  it("does not link inside a word or an address", () => {
    expect(splitGithubRefs("C#12 https://x.dev/a#12", "acme/web")).toBeUndefined();
  });
});

describe("shortenGithubUrl", () => {
  it("shortens issue, pull and commit addresses", () => {
    expect(shortenGithubUrl("https://github.com/acme/web/pull/48")).toEqual({
      label: "acme/web#48",
      href: "https://github.com/acme/web/pull/48",
    });
    expect(shortenGithubUrl("https://github.com/acme/web/commit/a1b2c3d4e5f6")).toEqual({
      label: "acme/web@a1b2c3d",
      href: "https://github.com/acme/web/commit/a1b2c3d4e5f6",
    });
  });
  it("keeps other addresses", () => {
    expect(shortenGithubUrl("https://github.com/acme/web/pull/48/files")).toBeUndefined();
    expect(shortenGithubUrl("https://evil.dev/acme/web/pull/48")).toBeUndefined();
  });
});

describe("rehypeGithubRefs", () => {
  const run = (children: object[], repo?: string) => {
    const tree = { type: "root", children } as never;
    rehypeGithubRefs(repo)()(tree);
    return JSON.stringify((tree as { children: unknown }).children);
  };
  const text = (value: string) => ({ type: "text", value });
  const el = (tagName: string, children: object[], properties = {}) => ({
    type: "element",
    tagName,
    properties,
    children,
  });
  it("wraps a reference in text, and one that is the whole inline code", () => {
    const out = run([el("p", [text("PR #48 and "), el("code", [text("a1b2c3d")])])], "acme/web");
    expect(out).toContain(
      '"tagName":"gh-ref","properties":{"dataHref":"https://github.com/acme/web/issues/48"}',
    );
    expect(out).toContain('"dataHref":"https://github.com/acme/web/commit/a1b2c3d"');
    expect(out).not.toContain('"tagName":"code"');
  });
  it("leaves code blocks and code that has more than a reference", () => {
    const out = run(
      [el("pre", [el("code", [text("#48")])]), el("p", [el("code", [text("git show #48")])])],
      "acme/web",
    );
    expect(out).not.toContain("gh-ref");
  });
  it("shortens a link that is its own address, and takes the repository from it", () => {
    const url = "https://github.com/acme/web/pull/48";
    const out = run([el("p", [el("a", [text(url)], { href: url }), text(" and #47")])]);
    expect(out).toContain('"value":"acme/web#48"');
    expect(out).toContain('"dataHref":"https://github.com/acme/web/issues/47"');
  });
});

describe("repoByRow", () => {
  it("gives each row its own repository, else the latest before it", () => {
    const rows = [
      { id: "a" },
      { id: "b", meta: { repos: ["acme/web"] } },
      { id: "c" },
      { id: "d", meta: { repos: ["acme/api", "acme/web"] } },
    ];
    expect([...repoByRow(rows)]).toEqual([
      ["b", "acme/web"],
      ["c", "acme/web"],
      ["d", "acme/api"],
    ]);
  });
});
