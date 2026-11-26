// Where the code of a release comes from: a commit of a clone on this computer, or one fetched from a repository address.
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type Commit, output, resolveCommit } from "./build";
import { InfraError } from "./errors";
import { embedded, type Workspace } from "./workspace";

/** The same address the installer clones (install.sh). */
export const PUBLIC_REPOSITORY = "https://github.com/g4rcez/zetta.git";

export type SourceSpec =
  | { from: "checkout"; root: string; ref: string }
  | { from: "remote"; url: string; ref: string };

/** A git folder that holds `commit`. `remove` deletes what was fetched for it. */
export type Source = { root: string; commit: Commit; remove: () => void };

const ADDRESS = /^(https:\/\/|ssh:\/\/|file:\/\/|git@)[^\s]+$/;
const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory();

/**
 * `repo` (a folder or an address) wins. Without it: the clone this runs in, at HEAD; with no clone, the public repository at the
 * commit this binary was built from, so a binary installs its own version unless `ref` names another.
 */
export function sourceSpec(
  workspace: Workspace,
  options: { repo?: string | undefined; ref?: string | undefined },
): SourceSpec {
  const { repo, ref } = options;
  if (repo !== undefined) {
    if (isFolder(repo)) return { from: "checkout", root: resolve(repo), ref: ref ?? "HEAD" };
    if (!ADDRESS.test(repo))
      throw new InfraError(`"${repo}" is not a folder here or the address of a repository.`);
    return { from: "remote", url: repo, ref: ref ?? "HEAD" };
  }
  if (workspace.root) return { from: "checkout", root: workspace.root, ref: ref ?? "HEAD" };
  return { from: "remote", url: PUBLIC_REPOSITORY, ref: ref ?? embedded()?.commit ?? "HEAD" };
}

export const describeSource = (spec: SourceSpec) =>
  spec.from === "checkout" ? `${spec.ref} of ${spec.root}` : `${spec.ref} of ${spec.url}`;

export async function openSource(spec: SourceSpec): Promise<Source> {
  if (spec.from === "checkout")
    return { root: spec.root, commit: await resolveCommit(spec.root, spec.ref), remove: () => {} };
  // git would read a leading "-" as an option.
  if (spec.ref.startsWith("-") || !ADDRESS.test(spec.url))
    throw new InfraError(`Cannot fetch "${spec.ref}" of "${spec.url}".`);
  const root = mkdtempSync(join(tmpdir(), "zetta-source-"));
  const remove = () => rmSync(root, { recursive: true, force: true });
  try {
    await output(["git", "init", "--quiet", root], tmpdir());
    // One commit is enough: the release is an archive of it.
    await output(["git", "fetch", "--quiet", "--depth", "1", spec.url, spec.ref], root);
    return { root, commit: await resolveCommit(root, "FETCH_HEAD"), remove };
  } catch {
    remove();
    // git has already printed its own reason.
    throw new InfraError(
      `Could not fetch "${spec.ref}" of ${spec.url}. Check the address and the ref.`,
    );
  }
}
