// The one transport: the system's ssh and rsync, so your keys, agent, known_hosts and ~/.ssh/config apply. One connection is shared
// by all the commands of a run, so a password or key passphrase is asked once.
import { mkdtempSync, rmSync } from "node:fs";
import { quote, type Step } from "./shell";

export type Target = {
  host: string;
  port: number;
  user: string;
  identityFile?: string | undefined;
};

export type Elevation = "root" | "self";

export type Remote = {
  user: string;
  /** Logs in without asking anything, and can use sudo. `fresh` opens a new connection instead of reusing one. */
  probe(options?: { fresh?: boolean }): Promise<boolean>;
  /** Runs a step's script and shows its output; the exit status is returned. */
  run(step: Step, as?: Elevation): Promise<number>;
  /** The output of a short command, or an error. */
  capture(command: string, as?: Elevation): Promise<string>;
  /** A command with your terminal attached; returns its exit status. */
  interactive(command?: string): Promise<number>;
  upload(folder: string, destination: string, filters: string[]): Promise<void>;
  /** Saves what a command writes to its output into a local file. */
  download(command: string, file: string, as?: Elevation): Promise<void>;
  close(): Promise<void>;
};

export function sshOptions(target: Target, controlFolder: string): string[] {
  return [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${controlFolder}/%C`,
    "-o",
    "ControlPersist=120",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ConnectTimeout=15",
    "-p",
    String(target.port),
    // With a key named, only that one is offered: an agent full of keys would use up the server's attempts first.
    ...(target.identityFile ? ["-i", target.identityFile, "-o", "IdentitiesOnly=yes"] : []),
  ];
}

/** rsync takes an IPv6 address in brackets. */
export const rsyncHost = (host: string) => (host.includes(":") ? `[${host}]` : host);

export function createRemote(target: Target): Remote {
  // Unix socket paths are short (about 104 bytes on macOS), so the system temporary folder is too long.
  const control = mkdtempSync("/tmp/zi-");
  const options = sshOptions(target, control);
  const address = `${target.user}@${target.host}`;
  const elevate = (command: string, as: Elevation) =>
    as === "root" && target.user !== "root" ? `sudo -n ${command}` : command;

  return {
    user: target.user,
    async probe({ fresh = false } = {}) {
      const check = target.user === "root" ? "true" : "sudo -n true";
      const extra = fresh ? ["-o", "ControlPath=none"] : [];
      // The first value of an ssh option wins, so the extra ones come first.
      const child = Bun.spawn(
        ["ssh", ...extra, "-o", "BatchMode=yes", ...options, address, check],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      return (await child.exited) === 0;
    },
    async run(step, as = "self") {
      const child = Bun.spawn(["ssh", ...options, address, elevate("bash -s", as)], {
        stdin: new TextEncoder().encode(step.script),
        stdout: "inherit",
        stderr: "inherit",
      });
      return child.exited;
    },
    async capture(command, as = "self") {
      const child = Bun.spawn(
        ["ssh", ...options, address, elevate(`bash -c ${quote(command)}`, as)],
        { stdin: "ignore", stdout: "pipe", stderr: "inherit" },
      );
      const output = await new Response(child.stdout).text();
      const status = await child.exited;
      if (status !== 0) throw new Error(`The remote command failed with status ${status}.`);
      return output.trim();
    },
    async interactive(command) {
      const child = Bun.spawn(["ssh", "-t", ...options, address, ...(command ? [command] : [])], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      return child.exited;
    },
    async upload(folder, destination, filters) {
      const shell = ["ssh", ...options].map((word) => `"${word}"`).join(" ");
      const child = Bun.spawn(
        [
          "rsync",
          "-az",
          "--delete",
          ...filters,
          "-e",
          shell,
          `${folder}/`,
          `${target.user}@${rsyncHost(target.host)}:${destination}/`,
        ],
        { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
      );
      const status = await child.exited;
      if (status !== 0) throw new Error(`rsync failed with status ${status}.`);
    },
    async download(command, file, as = "self") {
      const child = Bun.spawn(
        ["ssh", ...options, address, elevate(`bash -c ${quote(command)}`, as)],
        { stdin: "ignore", stdout: Bun.file(file), stderr: "inherit" },
      );
      const status = await child.exited;
      if (status !== 0) throw new Error(`The download failed with status ${status}.`);
    },
    async close() {
      const child = Bun.spawn(["ssh", ...options, "-O", "exit", address], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      await child.exited;
      rmSync(control, { recursive: true, force: true });
    },
  };
}
