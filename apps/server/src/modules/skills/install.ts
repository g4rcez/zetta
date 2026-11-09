import type { ActiveActor } from "../identity/access";
import { MarketError, parseSource, type Market } from "./market";
import { skillFields, SkillError, type Skills } from "./service";

export type InstallFailure = { path: string; code: string };
type Created = Awaited<ReturnType<Skills["create"]>>;
export type InstallResult = {
  installed: Created[];
  /** Skills that were already in the library and were given to more bots; their text is not changed. */
  attached: { id: string; name: string; botIds: string[] }[];
  failed: InstallFailure[];
  /** Why the skills could not be given to the bots (the skills are saved either way), or null. */
  attachError: string | null;
};

/**
 * Installs the chosen SKILL.md files of one repository, all at the same commit. Each file is read again from GitHub, so nothing the
 * browser sends is stored. A skill that cannot be installed (unsafe, too large, over the limits) is reported and the others go on.
 * The installed ones are then given to `botIds`. A skill that is already in the library is not installed again: it is given to
 * `botIds` too, next to the bots that have it (and when no bot is chosen there is nothing to do, which is reported).
 */
export async function installSelection(
  { skills, market }: { skills: Skills; market: Market },
  actor: ActiveActor,
  input: { repo: string; ref: string; paths: string[]; botIds: string[] },
): Promise<InstallResult> {
  const src = parseSource(input.repo);
  if (!src || src.ref || src.path || src.skill) throw new MarketError("INVALID_SOURCE");
  const have = new Map(
    (await skills.installedFrom(actor, `${src.owner}/${src.repo}`)).map(
      (m) => [m.path, m] as const,
    ),
  );
  const installed: Created[] = [];
  const attached: InstallResult["attached"] = [];
  const failed: InstallFailure[] = [];
  for (const path of new Set(input.paths)) {
    const there = have.get(path);
    if (there) {
      if (!input.botIds.length) {
        failed.push({ path, code: "INSTALLED" });
        continue;
      }
      try {
        const r = await skills.addBots(actor, there.id, input.botIds);
        attached.push({ id: there.id, name: there.name, botIds: r.botIds });
      } catch (e) {
        failed.push({ path, code: e instanceof SkillError ? e.code : "UNAVAILABLE" });
      }
      continue;
    }
    try {
      const p = await market.preview(src, path, input.ref);
      if (p.warnings.length) {
        failed.push({ path, code: "UNINSTALLABLE" });
        continue;
      }
      installed.push(
        await skills.create(
          actor,
          skillFields.parse({ name: p.name, description: p.description, body: p.body }),
          { repo: p.repo, path: p.path, ref: p.ref },
          p.files,
        ),
      );
    } catch (e) {
      failed.push({
        path,
        code: e instanceof SkillError || e instanceof MarketError ? e.code : "UNAVAILABLE",
      });
    }
  }
  let attachError: string | null = null;
  if (input.botIds.length)
    for (const s of installed) {
      try {
        s.botIds = (await skills.setBots(actor, s.id, input.botIds)).botIds;
      } catch (e) {
        attachError ??= e instanceof SkillError ? e.code : "UNAVAILABLE";
      }
    }
  return { installed, attached, failed, attachError };
}

/** What the update check says about one installed skill. */
export type SkillUpdate = {
  id: string;
  name: string;
  repo: string;
  /** The commit it was installed at, and the commit the repository is at now. */
  installedRef: string;
  latestRef: string;
  /** `update`: the repository has a different text or folder. `current`: nothing changed for this skill. `gone`: GitHub no longer has it. `unknown`: GitHub could not be asked. */
  state: "update" | "current" | "gone" | "unknown";
  /** The owner changed it after installing: an update would replace their changes. */
  edited: boolean;
};
const UPDATE_CHECK_MAX = 25;
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/**
 * Asks GitHub whether the skills installed from it changed. One question per repository (its current commit); only a repository that
 * moved is read further, and a skill is called an `update` only when its own text or folder differs from what is stored, so a busy
 * repository does not mark every skill. At most 25 skills are checked in one go.
 */
export async function checkUpdates(
  { skills, market }: { skills: Skills; market: Market },
  actor: ActiveActor,
): Promise<SkillUpdate[]> {
  const mine = (await skills.installedFrom(actor)).slice(0, UPDATE_CHECK_MAX);
  const latest = new Map<string, string | null>();
  let stopped = false;
  const out: SkillUpdate[] = [];
  for (const s of mine) {
    const src = s.repo ? parseSource(s.repo) : undefined;
    if (!src || !s.path || !s.ref) continue;
    const base = {
      id: s.id,
      name: s.name,
      repo: `${src.owner}/${src.repo}`,
      installedRef: s.ref,
      edited: s.sourceState === "edited",
    };
    if (stopped) {
      out.push({ ...base, latestRef: s.ref, state: "unknown" });
      continue;
    }
    try {
      if (!latest.has(base.repo))
        latest.set(base.repo, await market.commit({ owner: src.owner, repo: src.repo }));
      const head = latest.get(base.repo)!;
      if (head === s.ref) {
        out.push({ ...base, latestRef: head, state: "current" });
        continue;
      }
      const p = await market.preview(src, s.path, head);
      const stored = await skills.storedForCompare(actor, s.id);
      const unchanged =
        p.body === stored.body &&
        p.description === stored.description &&
        p.files.length === stored.files.length &&
        p.files.every(
          (f, i) => stored.files[i]?.path === f.path && same(f.content, stored.files[i]!.content),
        );
      out.push({ ...base, latestRef: head, state: unchanged ? "current" : "update" });
    } catch (e) {
      if (e instanceof MarketError && e.code === "NOT_FOUND")
        out.push({ ...base, latestRef: s.ref, state: "gone" });
      else {
        // A rate limit or an outage affects the rest too: do not ask again.
        stopped = true;
        out.push({ ...base, latestRef: s.ref, state: "unknown" });
      }
    }
  }
  return out;
}

/** Replaces an installed skill with what the repository has at `ref`. The checks of an install apply; a skill the owner edited needs `overwriteEdited`. */
export async function updateFromSource(
  { skills, market }: { skills: Skills; market: Market },
  actor: ActiveActor,
  id: string,
  input: { ref: string; overwriteEdited?: boolean },
) {
  const current = (await skills.installedFrom(actor)).find((s) => s.id === id);
  const src = current?.repo ? parseSource(current.repo) : undefined;
  if (!current || !src || !current.path) throw new SkillError("NOT_FOUND");
  // Before asking GitHub for anything: an edited skill needs the owner's yes.
  if (current.sourceState === "edited" && input.overwriteEdited !== true)
    throw new SkillError("EDITED");
  const p = await market.preview(src, current.path, input.ref);
  if (p.warnings.length) throw new MarketError("UNINSTALLABLE");
  return skills.replaceFromSource(
    actor,
    id,
    { description: p.description, body: p.body, ref: p.ref, files: p.files },
    { overwriteEdited: input.overwriteEdited === true },
  );
}
