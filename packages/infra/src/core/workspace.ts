// Where this program runs. In a clone of the repository it reads the clone: version pins, the code to release and
// `packages/infra/.env.<name>`. The compiled `zetta` binary also runs with no clone: the pins come inside it, the code is fetched
// (./source.ts) and the values are in the person's config folder.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { InfraError } from "./errors";
import { readVersions, type Versions } from "./versions";

export type Workspace = {
  /** `checkout`: inside a clone of the repository, whose folder is `root`. `standalone`: no clone. */
  mode: "checkout" | "standalone";
  root?: string;
  /** The folder of the `.env.<name>` files. */
  values: string;
  /** That folder as a message names it. */
  valuesLabel: string;
};

/** What the compiled binary carries (apps/cli/scripts/compile.ts sets it before anything else runs). */
export type Embedded = { versions: Versions; commit: string };
export const embedded = () => (globalThis as { zettaInfraEmbedded?: Embedded }).zettaInfraEmbedded;

function isClone(folder: string) {
  if (!existsSync(join(folder, "packages/infra/package.json"))) return false;
  try {
    const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
      name?: string;
    };
    return manifest.name === "zetta";
  } catch {
    return false;
  }
}

function cloneAbove(folder: string): string | undefined {
  for (let at = folder; ; at = dirname(at)) {
    if (isClone(at)) return at;
    if (dirname(at) === at) return undefined;
  }
}

export function findWorkspace(
  options: {
    cwd?: string;
    home?: string;
    /** The folder of this file. Run from source it is inside the clone; inside a compiled binary it is not a real folder. */
    source?: string;
    configHome?: string | undefined;
  } = {},
): Workspace {
  const source = options.source ?? import.meta.dir;
  const root = cloneAbove(source) ?? cloneAbove(options.cwd ?? process.cwd());
  if (root)
    return {
      mode: "checkout",
      root,
      values: join(root, "packages/infra"),
      valuesLabel: "packages/infra",
    };
  const home = options.home ?? homedir();
  const configHome =
    "configHome" in options ? options.configHome : process.env.XDG_CONFIG_HOME || undefined;
  return {
    mode: "standalone",
    values: join(configHome ?? join(home, ".config"), "zetta/infra"),
    valuesLabel: configHome ? join(configHome, "zetta/infra") : "~/.config/zetta/infra",
  };
}

/** The pinned versions: of the clone when there is one, so a change to a pin applies at once. */
export function resolveVersions(workspace: Workspace): Versions {
  if (workspace.root) return readVersions(workspace.root);
  const carried = embedded();
  if (carried) return carried.versions;
  throw new InfraError("Run this inside a clone of the repository, or use the zetta binary.");
}
