// The skills marketplace against the real GitHub: the commit a repository points to, the skills in it with what each says it does,
// a full preview of one skill read at that commit, a search, and the answer for a repository that does not exist.
// GitHub allows 60 unauthenticated API calls an hour, so this uses a handful and stops with "skipped" when the limit is hit.
//   bun scripts/e2e/skills-market.ts
import {
  MarketError,
  createMarket,
  parseSource,
} from "../../apps/server/src/modules/skills/market";
import { createReport } from "./report";

const report = createReport("skills-market", "Skills marketplace: the real GitHub");
const market = createMarket({
  suggestions: [
    { repo: "anthropics/skills", blurb: "Skills published by Anthropic.", trust: "official" },
  ],
});
const src = parseSource("anthropics/skills")!;
let limited = false;

async function step(name: string, run: () => Promise<string | void>) {
  if (limited)
    return report.skip(name, "GitHub's hourly limit for unauthenticated calls was reached");
  try {
    report.pass(name, (await run()) || undefined);
  } catch (e) {
    if (e instanceof MarketError && e.code === "RATE_LIMITED") {
      limited = true;
      report.skip(
        name,
        "GitHub's hourly limit for unauthenticated calls was reached; run again later",
      );
    } else report.fail(name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
}

let sha = "";
let first: { name: string; path: string } | undefined;
await step("the commit of the default branch is a real sha", async () => {
  sha = await market.commit(src);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a sha: ${sha}`);
  return sha.slice(0, 10);
});
await step("the repository lists its skills, each with a description", async () => {
  const d = await market.described(src);
  if (d.skills.length < 3) throw new Error(`only ${d.skills.length} skills found`);
  if (d.skills.some((k) => !k.name || !k.path.endsWith("SKILL.md")))
    throw new Error("a skill has no name or no SKILL.md path");
  const described = d.skills.filter((k) => k.description.length > 10).length;
  if (described < d.skills.length / 2)
    throw new Error(`only ${described} of ${d.skills.length} have a description`);
  first = d.skills[0];
  return `${d.skills.length} skills at ${d.ref.slice(0, 10)}, ${described} with a description`;
});
await step("a skill is previewed at the commit it was listed at, with its files", async () => {
  if (!first) throw new Error("no skill to preview");
  const p = await market.preview(src, first.path, sha);
  if (!p.name || p.ref !== sha)
    throw new Error(`preview of ${first.path} came back as ${p.name}@${p.ref}`);
  return `${p.name}: ${p.files.length} files, warnings: ${p.warnings.join(",") || "none"}`;
});
await step(
  "a search over the suggested repository finds a skill by a word of its name",
  async () => {
    if (!first) throw new Error("no skill to search for");
    const word = first.name.split(/[^a-z0-9]+/i).find((w) => w.length > 3) ?? first.name;
    const r = await market.search(word);
    if (!r.skills.some((k) => k.name === first!.name))
      throw new Error(`searching "${word}" did not return ${first!.name}`);
    return `"${word}" -> ${r.skills.length} result(s)`;
  },
);
await step("a repository that does not exist is NOT_FOUND, not a crash", async () => {
  try {
    await market.commit({ owner: "zetta-e2e-nobody", repo: "no-such-repository-9f3a" });
  } catch (e) {
    if (e instanceof MarketError && e.code === "NOT_FOUND") return;
    throw e;
  }
  throw new Error("it did not fail");
});
report.note(
  "Covers the read side (commit, list, describe, preview, search). Installing and the update check use the commit read here; the install into the database was tested with a fake GitHub and is not repeated.",
);
process.exit(report.finish("network to api.github.com and raw.githubusercontent.com (no token)"));
