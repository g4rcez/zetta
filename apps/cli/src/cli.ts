// The `zetta` command: one program for what is done around a Zetta server from a terminal. Each command is a function that takes its
// own arguments and returns an exit status, so a new one is a `case` here.
import { embedded, infra } from "@zetta/infra";
import { runSetup } from "./commands/setup";

export const USAGE = `Usage: zetta <command>

  setup     Write the .env files that run Zetta from a clone of the repository
  infra     Install Zetta on a server and keep it updated
  version   Which Zetta this program installs

Each command explains itself: zetta <command> --help`;

/** The compiled binary knows the commit it was built from, which is the one it installs. */
export function version(): string {
  const carried = embedded();
  return carried
    ? `zetta ${carried.commit.slice(0, 12)}`
    : "zetta, run from a clone of the repository";
}

export async function main(
  argv: string[],
  say: (line: string) => void = console.log,
): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "setup":
      return runSetup(rest);
    case "infra":
      return infra(rest, { program: "zetta infra", say });
    case "version":
    case "--version":
      say(version());
      return 0;
    case "help":
    case "--help":
    case "-h":
      say(USAGE);
      return 0;
    default:
      say(USAGE);
      return 1;
  }
}
