#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { isHost, lanAddresses } from "./network";
import { planSetup, type SetupMode } from "./setup";

const USAGE = `Usage: zetta setup [--mode local|lan] [--address <ip-or-host>]

  --mode     local: this computer only (http://localhost)
             lan:   your local network (https, a certificate for the address)
  --address  the address other devices use in lan mode; default: this machine's private IPv4 address

Writes apps/server/.env and apps/web/.env. Secrets that already have a value are kept.`;

const root = join(import.meta.dir, "../../..");
const files = { server: join(root, "apps/server/.env"), web: join(root, "apps/web/.env") };
const read = async (path: string) => (existsSync(path) ? readFile(path, "utf8") : "");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string" },
    address: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals[0] !== "setup") {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const rl = process.stdin.isTTY
  ? createInterface({ input: process.stdin, output: process.stdout })
  : undefined;
async function ask(question: string): Promise<string> {
  if (!rl)
    throw new Error(`${question}\nPass the value as a flag: this is not an interactive terminal.`);
  return (await rl.question(`${question} `)).trim();
}

async function chooseMode(): Promise<SetupMode> {
  const mode =
    values.mode ??
    (await ask("Run Zetta on [local] this computer only or [lan] your local network?"));
  if (mode !== "local" && mode !== "lan")
    throw new Error(`Unknown mode "${mode}". Use local or lan.`);
  return mode;
}

async function chooseAddress(): Promise<string> {
  const found = lanAddresses(networkInterfaces());
  const address =
    values.address ??
    (found.length === 1
      ? found[0]
      : await ask(`Address for other devices${found.length ? ` (${found.join(", ")})` : ""}:`));
  if (!address || !isHost(address))
    throw new Error(`"${address ?? ""}" is not an IPv4 address or host name.`);
  return address;
}

async function main() {
  const mode = await chooseMode();
  const address = mode === "lan" ? await chooseAddress() : undefined;
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

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rl?.close();
}
