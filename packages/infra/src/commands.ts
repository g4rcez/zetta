// What each command of the CLI does. They talk to the server only through `Remote`, so `--dry-run` and the tests give them another one.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildRelease,
  hasUncommittedWork,
  releaseName,
  resolveCommit,
  UPLOAD_FILTERS,
} from "./build";
import type { Agent, Environment } from "./environment";
import { APP_USER, PATHS, SERVICE_PATH } from "./layout";
import { quote, type Step } from "./shell";
import type { Elevation, Remote } from "./ssh";
import { adminUserStep, hostSteps, REBOOT_REQUIRED, sshdStep } from "./steps";
import {
  activateStep,
  backupStep,
  installStep,
  migrateStep,
  NEWEST_BACKUP,
  preflightStep,
  prepareStep,
  pruneStep,
  restartStep,
  rollbackStep,
  statusStep,
} from "./steps/release";
import { harnessImage } from "./steps/runtime";
import { repoRoot, type Versions } from "./versions";

export type Context = {
  environment: Environment;
  versions: Versions;
  /** A connection as a user of the server. */
  connect: (user: string) => Remote;
  mode: "apply" | "dry-run";
  say: (line: string) => void;
};

export class CommandError extends Error {}

const admin = (context: Context) => context.connect(context.environment.ssh.user);

async function perform(context: Context, remote: Remote, step: Step, as: Elevation = "root") {
  context.say(`\n== ${step.title}  [${remote.user}@${context.environment.host}]`);
  const status = await remote.run(step, as);
  if (status === REBOOT_REQUIRED && step.id === "packages")
    throw new CommandError(
      `Restart the server (infra ssh, then: sudo reboot), wait a minute and run bootstrap again.`,
    );
  if (status !== 0) throw new CommandError(`The step "${step.id}" failed with status ${status}.`);
}

async function requireLogin(context: Context, remote: Remote) {
  if (await remote.probe()) return;
  throw new CommandError(
    `Cannot log in as ${remote.user}@${context.environment.host} with a key and sudo. Run bootstrap first.`,
  );
}

export function publicKeyPath(identityFile: string | undefined, home: string = homedir()) {
  if (!identityFile) return join(home, ".ssh", "id_ed25519.pub");
  return identityFile.endsWith(".pub") ? identityFile : `${identityFile}.pub`;
}

function readPublicKey(context: Context) {
  const path = publicKeyPath(context.environment.ssh.identityFile);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  if (context.mode === "dry-run") return "ssh-ed25519 AAAAexample";
  throw new CommandError(
    `There is no public key at ${path}. Create a key pair (ssh-keygen -t ed25519) or set DEPLOY_SSH_KEY.`,
  );
}

export async function bootstrap(context: Context) {
  const { environment, versions } = context;
  const you = admin(context);
  const key = readPublicKey(context);
  // The first run happens as root, which sshd closes at the end of the access steps.
  const first = (await you.probe()) ? you : context.connect("root");
  await perform(context, first, adminUserStep(environment, key));
  if (!(await you.probe({ fresh: true })))
    throw new CommandError(
      `The login as ${you.user} does not work, so root login stays open. Check the key and sudo, then run bootstrap again.`,
    );
  await perform(context, you, sshdStep());
  if (!(await you.probe({ fresh: true }))) {
    // The shared connection is still open: take the change back through it.
    await you.capture(
      "rm -f /etc/ssh/sshd_config.d/10-zetta.conf && systemctl reload sshd",
      "root",
    );
    throw new CommandError(
      "A new login failed after the SSH change, so it was removed. Check the server's sshd settings.",
    );
  }
  for (const step of hostSteps(environment, versions)) await perform(context, you, step);
  context.say(`\nThe server is ready. Next:
  1. bun run infra secrets backup --env ${environment.name}   (store the connection key somewhere safe)
  2. bun run infra deploy --env ${environment.name}
  3. bun run infra login ${environment.agents[0] ?? "claude-code"} --env ${environment.name}`);
}

export async function deploy(context: Context, ref = "HEAD") {
  const { environment } = context;
  const you = admin(context);
  await requireLogin(context, you);
  await perform(context, you, preflightStep());

  const commit = await resolveCommit(repoRoot, ref);
  if (ref === "HEAD" && (await hasUncommittedWork(repoRoot)))
    context.say("\nwarning: there is uncommitted work here. Only the commit is deployed.");
  const id = releaseName(new Date(), commit.id);
  const destination = `${PATHS.releases}/${id}.partial`;
  const filters = UPLOAD_FILTERS;
  context.say(`\n== Release ${id}`);
  if (context.mode === "dry-run") {
    context.say(`would build commit ${commit.id} on this computer (server and web)`);
    await perform(context, you, prepareStep(id), "self");
    await you.upload("<build folder>", destination, filters);
  } else {
    const built = await buildRelease({
      root: repoRoot,
      commit,
      serverUrl: `https://${environment.domain}`,
    });
    try {
      await perform(context, you, prepareStep(id), "self");
      context.say("\n== Upload");
      await you.upload(built.source, destination, filters);
    } finally {
      built.remove();
    }
  }
  await perform(context, you, installStep(id), "self");
  await perform(context, you, migrateStep(id));
  await perform(context, you, activateStep(id));
  await perform(context, you, pruneStep(environment.keep.releases), "self");
  if (context.mode === "apply") await checkPublicAddress(context);
}

/** The release is live when this runs: a failure here is DNS, the certificate or the firewall, which no rollback would fix. */
async function checkPublicAddress(context: Context) {
  const address = `https://${context.environment.domain}/readyz`;
  try {
    const answer = await fetch(address, { signal: AbortSignal.timeout(15_000) });
    if (answer.ok) return context.say(`\nDeployed: https://${context.environment.domain}`);
    context.say(`\nwarning: ${address} answered ${answer.status}. Check: bun run infra logs --all`);
  } catch (error) {
    context.say(
      `\nwarning: ${address} could not be reached (${(error as Error).message}). Check the DNS record and: bun run infra logs --all`,
    );
  }
}

export async function rollback(context: Context, to?: string) {
  const you = admin(context);
  await requireLogin(context, you);
  await perform(context, you, rollbackStep(to));
}

export async function migrate(context: Context) {
  const you = admin(context);
  await requireLogin(context, you);
  await perform(context, you, migrateStep("current"));
}

export async function restart(context: Context) {
  const you = admin(context);
  await requireLogin(context, you);
  await perform(context, you, restartStep());
}

export async function status(context: Context) {
  const you = admin(context);
  await requireLogin(context, you);
  await perform(context, you, statusStep());
}

export async function logs(context: Context, options: { follow: boolean; all: boolean }) {
  const units = options.all ? ["zetta", "caddy", "postgresql"] : ["zetta"];
  const command = `sudo journalctl ${units.map((unit) => `-u ${unit}`).join(" ")} -n 200 ${options.follow ? "-f" : "--no-pager"}`;
  await admin(context).interactive(command);
}

/** The command that signs an agent CLI in as the user bot runs use. */
export function loginCommand(context: Context, agent: Agent, account?: string): string {
  const { environment, versions } = context;
  if (!environment.agents.includes(agent))
    throw new CommandError(`The environment ${environment.name} does not install ${agent}.`);
  const program = agent === "claude-code" ? "claude auth login" : "codex login --device-auth";
  if (environment.sandbox === "host")
    return `sudo -u ${APP_USER} -H env -C ${PATHS.home} PATH=${SERVICE_PATH} ${program}`;
  if (agent !== "claude-code") throw new CommandError("The bot run image holds Claude Code only.");
  if (!account || !/^[A-Za-z0-9_-]{1,100}$/.test(account))
    throw new CommandError(
      "In the podman sandbox every person signs in apart: pass --account <their Zetta user id>.",
    );
  const home = `${PATHS.harnessHomes}/${account}/${agent}`;
  const script = [
    `cd ${PATHS.home}`,
    `export XDG_RUNTIME_DIR=/run/user/$(id -u)`,
    `mkdir -p -m 700 ${home}`,
    `exec podman run --rm -it --user "$(id -u):$(id -g)" -v ${home}:/home/agent:rw -e HOME=/home/agent ${harnessImage(versions)} ${program}`,
  ].join(" && ");
  return `sudo -u ${APP_USER} -H bash -c ${quote(script)}`;
}

export async function login(context: Context, agent: Agent, account?: string) {
  const command = loginCommand(context, agent, account);
  const status = await admin(context).interactive(command);
  if (status !== 0) throw new CommandError(`The sign-in ended with status ${status}.`);
}

export async function backup(context: Context, pullTo: string | undefined) {
  const you = admin(context);
  await requireLogin(context, you);
  if (pullTo === undefined) return perform(context, you, backupStep());
  const newest = await you.capture(NEWEST_BACKUP, "root");
  if (context.mode === "dry-run") return;
  const found = new RegExp(`^${PATHS.backups}/[a-z]+/(\\d{8}T\\d{6}Z)$`).exec(newest);
  if (!found) throw new CommandError("There is no backup on the server yet: run `infra backup`.");
  mkdirSync(pullTo, { recursive: true, mode: 0o700 });
  const folder = join(pullTo, found[1]!);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const archive = `${folder}.tar`;
  try {
    await you.download(`tar -C ${quote(newest)} -cf - .`, archive, "root");
    const unpack = Bun.spawn(["tar", "-xf", archive, "-C", folder], { stderr: "inherit" });
    if ((await unpack.exited) !== 0) throw new CommandError("The backup could not be unpacked.");
  } finally {
    rmSync(archive, { force: true });
  }
  context.say(`Saved ${newest} to ${folder}`);
}

export async function secret(context: Context, which: "backup" | "setup-key") {
  const you = admin(context);
  await requireLogin(context, you);
  const name = which === "backup" ? "ZETTA_CONNECTION_KEY" : "ZETTA_SETUP_KEY";
  const line = await you.capture(`grep '^${name}=' ${PATHS.secretsEnv}`, "root");
  context.say(
    which === "backup"
      ? `Keep this in your password manager. Without it, a restored database cannot open the saved connections.\n${line}`
      : `Paste this when Zetta asks for the setup key.\n${line}`,
  );
}

export async function shell(context: Context) {
  await admin(context).interactive();
}
