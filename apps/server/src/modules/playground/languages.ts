import type { PlaygroundLanguage, PlaygroundRunner } from "@zetta/db/schema/playground";

/** The runner limits of a playground (see docs/decisions/playground.md). */
export const PLAYGROUND_LIMITS = {
  files: 50,
  /** Characters of source over all files of one playground. */
  sourceBytes: 1_000_000,
  inputsBytes: 64_000,
  /** The tail of each of stdout and stderr that a run keeps. */
  streamBytes: 64_000,
  outputBytes: 5_000_000,
  outputFiles: 50,
  keepRuns: 20,
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
} as const;

export type Cli = {
  bin: string;
  args(entry: string): string[];
  /** Prints the version; the first line is kept. */
  version: string[];
  /** The image of the language container (the container runner). */
  image: string;
};
export type LanguageSpec = {
  label: string;
  runners: readonly PlaygroundRunner[];
  defaultEntry: string;
  /** A new language is one entry here: its CLI and its image. Absent for a language that only the page can run. */
  cli?: Cli;
};

/** The map of language to CLI. */
export const LANGUAGES: Record<PlaygroundLanguage, LanguageSpec> = {
  typescript: {
    label: "TypeScript",
    runners: ["host", "container", "browser"],
    defaultEntry: "main.ts",
    cli: {
      bin: "bun",
      args: (entry) => ["run", entry],
      version: ["--version"],
      image: "docker.io/oven/bun:1.3.14",
    },
  },
  javascript: {
    label: "JavaScript",
    runners: ["host", "container", "browser"],
    defaultEntry: "main.js",
    cli: {
      bin: "bun",
      args: (entry) => ["run", entry],
      version: ["--version"],
      image: "docker.io/oven/bun:1.3.14",
    },
  },
  python: {
    label: "Python",
    runners: ["host", "container"],
    defaultEntry: "main.py",
    cli: {
      bin: "python3",
      args: (entry) => [entry],
      version: ["--version"],
      image: "docker.io/library/python:3.13-slim",
    },
  },
  bash: {
    label: "Shell",
    runners: ["host", "container"],
    defaultEntry: "main.sh",
    cli: {
      bin: "bash",
      args: (entry) => [entry],
      version: ["--version"],
      image: "docker.io/library/debian:trixie-slim",
    },
  },
  html: { label: "HTML", runners: ["browser"], defaultEntry: "index.html" },
};

const VERSION_TTL_MS = 60_000;
const versions = new Map<string, { at: number; value: string | null }>();

/** The version line of a CLI on this host, or null when it is not installed. Asked at most once a minute per CLI. */
export async function hostVersion(language: PlaygroundLanguage): Promise<string | null> {
  const cli = LANGUAGES[language].cli;
  if (!cli) return null;
  const hit = versions.get(cli.bin);
  if (hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.value;
  let value: string | null = null;
  const path = Bun.which(cli.bin);
  if (path) {
    try {
      const proc = Bun.spawn([path, ...cli.version], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        timeout: 5000,
      });
      const text = await new Response(proc.stdout as ReadableStream).text();
      value = text.split("\n")[0]?.trim().slice(0, 80) || "unknown";
    } catch {
      value = null;
    }
  }
  versions.set(cli.bin, { at: Date.now(), value });
  return value;
}
