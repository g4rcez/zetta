// A kind of infra is one way to run Zetta somewhere: `vps` puts everything on one host. Each kind is a folder beside `core/` with its
// own commands, environment shape and files. An environment (`environments/<name>.ts`) says which kind it is, so
// `infra <command> --env <name>` reaches the right one. To add a kind: its folder, one line in `../kinds.ts`.
import type { Workspace } from "./workspace";

export type KindCall<Define> = {
  /** Everything after `infra`, the `--env` option included. */
  argv: string[];
  /** How the person called this program, for the hints it prints: `bun run infra` or `zetta infra`. */
  program: string;
  environment: { name: string; define: Define };
  workspace: Workspace;
  say: (line: string) => void;
};

export type InfraKind<Id extends string, Define> = {
  id: Id;
  /** One line that says what this kind installs. */
  title: string;
  usage: (program: string) => string;
  /** Runs one command and returns the exit status. */
  run: (call: KindCall<Define>) => Promise<number>;
};

/** What an environment file exports. */
export type EnvironmentEntry<Id extends string, Define> = { kind: Id; define: Define };
