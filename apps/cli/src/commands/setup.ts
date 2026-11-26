// zetta setup: writes the .env files that run Zetta from a clone of the repository.
import { findWorkspace } from "@zetta/infra";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { isHost, lanAddresses } from "../network";
import { planSetup, type SetupMode } from "../setup";

export const USAGE = `Usage: zetta setup [--mode local|lan] [--address <ip-or-host>]

  --mode     local: this computer only (http://localhost)
             lan:   your local network (https, a certificate for the address)
  --address  the address other devices use in lan mode; default: this machine's private IPv4 address

Writes apps/server/.env and apps/web/.env. Secrets that already have a value are kept.`;

const read = async (path: string) => (existsSync(path) ? readFile(path, "utf8") : "");

type Ask = (question: string) => Promise<string>;

async function chooseMode(given: string | undefined, ask: Ask): Promise<SetupMode> {
  const mode =
    given ?? (await ask("Run Zetta on [local] this computer only or [lan] your local network?"));
  if (mode !== "local" && mode !== "lan")
    throw new Error(`Unknown mode "${mode}". Use local or lan.`);
  return mode;
}

async function chooseAddress(given: string | undefined, ask: Ask): Promise<string> {
  const found = lanAddresses(networkInterfaces());
  const address =
    given ??
    (found.length === 1
      ? found[0]
      : await ask(`Address for other devices${found.length ? ` (${found.join(", ")})` : ""}:`));
  if (!address || !isHost(address))
    throw new Error(`"${address ?? ""}" is not an IPv4 address or host name.`);
  return address;
}

async function setup(values: { mode?: string; address?: string }, ask: Ask) {
  // The files belong to a clone: the one this runs from, or the one the current folder is in.
  const { root } = findWorkspace();
  if (!root)
    throw new Error(
      "zetta setup writes the .env files of a clone of the repository. Run it in a folder of one.",
    );
  const files = { server: join(root, "apps/server/.env"), web: join(root, "apps/web/.env") };
  const mode = await chooseMode(values.mode, ask);
  const address = mode === "lan" ? await chooseAddress(values.address, ask) : undefined;
  const result = planSetup({
    mode,
    address,
    server: await read(files.server),
    web: await read(files.web),
  });

  // The certificate comes first: without mkcert nothing is written.
  if (address) {
    const certs = Bun.spawn(["bash", "scripts/dev-certs.sh", address], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if ((await certs.exited) !== 0)
      throw new Error("Certificate creation failed. No .env file was changed.");
  }

  // 0o600 applies when the file is created; the files hold secrets.
  await writeFile(files.server, result.server, { mode: 0o600 });
  await writeFile(files.web, result.web, { mode: 0o600 });

  console.log(`\nWrote apps/server/.env (${result.changed.server.join(", ")})`);
  console.log(`Wrote apps/web/.env (${result.changed.web.join(", ")})`);
  if (result.setupKey)
    console.log(`\nSetup key for the first onboarding step (shown once):\n  ${result.setupKey}`);
  if (mode === "lan")
    console.log(
      "\nOther devices must trust the local root certificate once: install .certs/rootCA.pem on each of them.",
    );
  console.log(`\nRestart \`bun dev\` (or \`bun run zetta\`), then open ${result.url}/onboarding`);
}

/** Runs `zetta setup <argv>` and returns the exit status. */
export async function runSetup(argv: string[]): Promise<number> {
  let rl: Interface | undefined;
  try {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        mode: { type: "string" },
        address: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (process.stdin.isTTY) rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask: Ask = async (question) => {
      if (!rl)
        throw new Error(
          `${question}\nPass the value as a flag: this is not an interactive terminal.`,
        );
      return (await rl.question(`${question} `)).trim();
    };
    await setup(values, ask);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  } finally {
    rl?.close();
  }
}
