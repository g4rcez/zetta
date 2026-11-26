// The server runs the versions the repository already pins, read from where they are pinned, so there is one place to change each.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Agent } from "./environment";

export const repoRoot = join(import.meta.dir, "../../..");

export type Versions = {
  bun: string;
  agents: Record<Agent, { package: string; version: string }>;
  /** The Dockerfile of the throwaway container a bot run uses in the `podman` sandbox. */
  harnessDockerfile: string;
};

function pinned(text: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(text)?.[1];
  if (!found) throw new Error(`Cannot find the pinned version of ${what}.`);
  return found;
}

export function readVersions(root: string = repoRoot): Versions {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const server = read("apps/server/Dockerfile");
  const manifest = read("package.json");
  return {
    bun: pinned(manifest, /"packageManager":\s*"bun@([0-9][0-9.]*)"/, "Bun (package.json)"),
    agents: {
      "claude-code": {
        package: "@anthropic-ai/claude-code",
        version: pinned(server, /^ARG CLAUDE_CODE_VERSION=([0-9][0-9.]*)$/m, "Claude Code"),
      },
      codex: {
        package: "@openai/codex",
        version: pinned(server, /^ARG CODEX_VERSION=([0-9][0-9.]*)$/m, "Codex"),
      },
    },
    harnessDockerfile: read("docker/harness/Dockerfile"),
  };
}
