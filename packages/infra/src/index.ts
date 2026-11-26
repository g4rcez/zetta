// `infra <command> [--env <name>]`: finds the environment, and hands the command to the kind of infra that environment is.
import { ENVIRONMENTS } from "../environments";
import { InfraError } from "./core/errors";
import { findWorkspace, type Workspace } from "./core/workspace";
import { KINDS } from "./kinds";

export { InfraError } from "./core/errors";
export { readVersions, type Versions } from "./core/versions";
export { embedded, type Embedded, findWorkspace, type Workspace } from "./core/workspace";
export { KINDS, type KindId } from "./kinds";

export type InfraOptions = {
  /** How the person called this program, for the usage and the hints: `bun run infra` or `zetta infra`. */
  program: string;
  say?: (line: string) => void;
  workspace?: Workspace;
};

type Entry = (typeof ENVIRONMENTS)[keyof typeof ENVIRONMENTS];

/** The value of `--env`, wherever it is among the arguments. Each kind parses the rest. */
export function environmentName(argv: string[]): string {
  for (const [index, word] of argv.entries()) {
    if (word === "--env") return argv[index + 1] ?? "";
    if (word.startsWith("--env=")) return word.slice("--env=".length);
  }
  return "production";
}

export function findEnvironment(name: string): Entry {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name))
    throw new InfraError(`"${name}" is not an environment name.`);
  const entry = (ENVIRONMENTS as Record<string, Entry | undefined>)[name];
  if (!entry)
    throw new InfraError(
      `There is no environment "${name}". The ones here: ${Object.keys(ENVIRONMENTS).join(", ")}. To add one, write packages/infra/environments/${name}.ts and list it in environments/index.ts.`,
    );
  return entry;
}

export async function infra(argv: string[], options: InfraOptions): Promise<number> {
  const name = environmentName(argv);
  const entry = findEnvironment(name);
  return KINDS[entry.kind].run({
    argv,
    program: options.program,
    environment: { name, define: entry.define },
    workspace: options.workspace ?? findWorkspace(),
    say: options.say ?? ((line) => console.log(line)),
  });
}

/** For a program whose whole job is this command: runs it and ends the process, showing a known problem without a stack. */
export async function runInfra(argv: string[], options: InfraOptions): Promise<never> {
  try {
    process.exit(await infra(argv, options));
  } catch (error) {
    const known = error instanceof InfraError;
    console.error(`\nerror: ${known ? error.message : ((error as Error).stack ?? error)}`);
    process.exit(1);
  }
}
