// <program> <command> [--env production] [--dry-run]     (docs/operations/vps.md)
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import * as commands from "./commands";
import {
  AGENTS,
  type Agent,
  DRY_RUN_VALUES,
  type EnvironmentDefinition,
  parseEnvironment,
  readValues,
} from "./environment";
import type { KindCall } from "../core/kind";
import { createRemote, type Remote } from "../core/ssh";
import { createDryRemote } from "../core/dry-run";
import { resolveVersions } from "../core/workspace";

export const usage = (
  program: string,
) => `Usage: ${program} <command> [--env production] [--dry-run]

  bootstrap                 Prepare an Arch Linux server (safe to run again)
  deploy [--ref <git ref>]  Build here, upload, back up, migrate, switch (default ref: HEAD)
         [--repo <source>]  Take the code from another clone (a folder) or from a repository address
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

export async function run(call: KindCall<EnvironmentDefinition>): Promise<number> {
  const { program, workspace, say } = call;
  const { values, positionals } = parseArgs({
    args: call.argv,
    allowPositionals: true,
    options: {
      env: { type: "string", default: "production" },
      "dry-run": { type: "boolean", default: false },
      ref: { type: "string" },
      repo: { type: "string" },
      to: { type: "string" },
      account: { type: "string" },
      follow: { type: "boolean", short: "f", default: false },
      all: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, argument] = positionals;
  if (!command || values.help) {
    say(usage(program));
    return values.help ? 0 : 2;
  }

  const mode = values["dry-run"] ? "dry-run" : "apply";
  const { name, define } = call.environment;
  const given = readValues(name, process.env, workspace.values);
  const environment = parseEnvironment(
    name,
    define,
    mode === "dry-run" ? { ...DRY_RUN_VALUES, ...given } : given,
    `${workspace.valuesLabel}/.env.${name}`,
  );
  environment.ssh.identityFile = expandHome(environment.ssh.identityFile);

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
  const context: commands.Context = {
    environment,
    versions: resolveVersions(workspace),
    connect,
    mode,
    say,
    program,
    workspace,
  };

  try {
    switch (command) {
      case "bootstrap":
        await commands.bootstrap(context);
        break;
      case "deploy":
        await commands.deploy(context, {
          ...(values.ref === undefined ? {} : { ref: values.ref }),
          ...(values.repo === undefined ? {} : { repo: values.repo }),
        });
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
        console.error(`Unknown command "${command}".\n\n${usage(program)}`);
        return 2;
    }
    return 0;
  } finally {
    await Promise.all([...remotes.values()].map((remote) => remote.close()));
  }
}
