// bun run infra <command> [--env production] [--dry-run]     (docs/operations/vps.md)
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import * as commands from "./commands";
import {
  AGENTS,
  type Agent,
  DRY_RUN_VALUES,
  EnvironmentError,
  loadDefinition,
  parseEnvironment,
  readValues,
} from "./environment";
import { createRemote, type Remote } from "./ssh";
import { createDryRemote } from "./dry-run";
import { readVersions } from "./versions";

export const USAGE = `Usage: bun run infra <command> [--env production] [--dry-run]

  bootstrap                 Prepare an Arch Linux server (safe to run again)
  deploy [--ref <git ref>]  Build here, upload, back up, migrate, switch (default ref: HEAD)
  rollback [--to <release>] Run an earlier release again
  migrate                   Back up, then migrate the running release
  restart                   Restart Zetta and wait until it answers
  status                    Units, health, memory, disk, releases and backups
  logs [-f] [--all]         The server's log (--all adds Caddy and Postgres)
  login <agent>             Sign an agent CLI in (claude-code, codex); podman sandbox: --account <user id>
  backup                    Back up now
  backup pull [--to <dir>]  Download the newest backup (default: ~/zetta-backups/<env>)
  secrets backup            Show the connection key, to keep it somewhere safe
  secrets setup-key         Show the key the first sign-in asks for
  ssh                       A shell on the server
`;

const expandHome = (path: string | undefined) =>
  path?.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      env: { type: "string", default: "production" },
      "dry-run": { type: "boolean", default: false },
      ref: { type: "string" },
      to: { type: "string" },
      account: { type: "string" },
      follow: { type: "boolean", short: "f", default: false },
      all: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, argument] = positionals;
  if (!command || values.help) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const mode = values["dry-run"] ? "dry-run" : "apply";
  const define = await loadDefinition(values.env);
  const given = readValues(values.env);
  const environment = parseEnvironment(
    values.env,
    define,
    mode === "dry-run" ? { ...DRY_RUN_VALUES, ...given } : given,
  );
  environment.ssh.identityFile = expandHome(environment.ssh.identityFile);

  const say = (line: string) => console.log(line);
  const remotes = new Map<string, Remote>();
  const connect = (user: string) => {
    let remote = remotes.get(user);
    if (!remote) {
      const target = { host: environment.host, ...environment.ssh, user };
      remote = mode === "dry-run" ? createDryRemote(user, say) : createRemote(target);
      remotes.set(user, remote);
    }
    return remote;
  };
  const context: commands.Context = { environment, versions: readVersions(), connect, mode, say };

  try {
    switch (command) {
      case "bootstrap":
        await commands.bootstrap(context);
        break;
      case "deploy":
        await commands.deploy(context, values.ref);
        break;
      case "rollback":
        await commands.rollback(context, values.to);
        break;
      case "migrate":
        await commands.migrate(context);
        break;
      case "restart":
        await commands.restart(context);
        break;
      case "status":
        await commands.status(context);
        break;
      case "logs":
        await commands.logs(context, { follow: values.follow, all: values.all });
        break;
      case "login": {
        const agent = argument === "claude" ? "claude-code" : argument;
        if (!AGENTS.includes(agent as Agent))
          throw new commands.CommandError(`Name the agent: ${AGENTS.join(" or ")}.`);
        await commands.login(context, agent as Agent, values.account);
        break;
      }
      case "backup":
        if (argument && argument !== "pull")
          throw new commands.CommandError("Use `backup` or `backup pull`.");
        await commands.backup(
          context,
          argument === "pull"
            ? (expandHome(values.to) ?? join(homedir(), "zetta-backups", environment.name))
            : undefined,
        );
        break;
      case "secrets":
        if (argument !== "backup" && argument !== "setup-key")
          throw new commands.CommandError("Use `secrets backup` or `secrets setup-key`.");
        await commands.secret(context, argument);
        break;
      case "ssh":
        await commands.shell(context);
        break;
      default:
        console.error(`Unknown command "${command}".\n\n${USAGE}`);
        return 2;
    }
    return 0;
  } finally {
    await Promise.all([...remotes.values()].map((remote) => remote.close()));
  }
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    const known = error instanceof commands.CommandError || error instanceof EnvironmentError;
    console.error(`\nerror: ${known ? error.message : ((error as Error).stack ?? error)}`);
    process.exit(1);
  }
}
