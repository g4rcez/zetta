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
