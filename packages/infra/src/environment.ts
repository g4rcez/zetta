// One deploy target. The shape is tracked; everything that names a real machine (address, domain, key) comes from the untracked
// `packages/infra/.env.<name>` or from the process environment, so the public repository never holds it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";

export const infraRoot = join(import.meta.dir, "..");

/** The values an environment file may use. Declared in `packages/infra/.env.schema`. */
export const VALUE_NAMES = [
  "DEPLOY_HOST",
  "DEPLOY_DOMAIN",
  "DEPLOY_SSH_USER",
  "DEPLOY_SSH_PORT",
  "DEPLOY_SSH_KEY",
  "DEPLOY_ACME_EMAIL",
] as const;
export type ValueName = (typeof VALUE_NAMES)[number];
export type DeployValues = Partial<Record<ValueName, string>>;

export const AGENTS = ["claude-code", "codex"] as const;
export type Agent = (typeof AGENTS)[number];

/** `host`: bot runs are processes of the `zetta` user. `podman`: each run is a throwaway rootless container. */
export const SANDBOXES = ["host", "podman"] as const;
export type Sandbox = (typeof SANDBOXES)[number];

// Service accounts of the host: the admin login may not be one of them.
const RESERVED_USERS = ["root", "zetta", "postgres", "caddy"];

const memory = z.string().regex(/^\d+(\.\d+)?[MG]$/, "use a systemd size such as 2G or 512M");
const pgSize = z.string().regex(/^\d+(MB|GB)$/, "use a Postgres size such as 512MB");

const schema = z.strictObject({
  name: z.string(),
  // A leading "-" would be read by ssh as an option, so a host is letters, digits, dots, colons (IPv6) and inner dashes only.
  host: z
    .string({ error: "DEPLOY_HOST is missing" })
    .regex(/^[A-Za-z0-9:]([A-Za-z0-9.:-]*[A-Za-z0-9:])?$/, "DEPLOY_HOST must be an IP or a name"),
  domain: z
    .string({ error: "DEPLOY_DOMAIN is missing" })
    .regex(
      /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      "DEPLOY_DOMAIN must be a lower case domain name, with no https:// and no path",
    ),
  ssh: z.strictObject({
    user: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "DEPLOY_SSH_USER must be a Linux user name")
      .refine(
        (user) => !RESERVED_USERS.includes(user),
        "DEPLOY_SSH_USER must be your own admin user",
      ),
    port: z.coerce.number().int().min(1).max(65535),
    identityFile: z.string().min(1).optional(),
  }),
  acmeEmail: z.email("DEPLOY_ACME_EMAIL must be an email address").optional(),
  agents: z.array(z.enum(AGENTS)),
  sandbox: z.enum(SANDBOXES),
  swapGiB: z.number().int().min(0).max(32),
  postgres: z.strictObject({
    sharedBuffers: pgSize,
    effectiveCacheSize: pgSize,
    workMem: pgSize,
    maintenanceWorkMem: pgSize,
    maxConnections: z.number().int().min(20).max(500),
    /** The app's pool (`ZETTA_DB_POOL_MAX`); the rest of the connections are for backups, migrations and you. */
    appPool: z.number().int().min(2).max(100),
  }),
  service: z.strictObject({ memoryHigh: memory, memoryMax: memory }),
  keep: z.strictObject({
    releases: z.number().int().min(2).max(50),
    backups: z.number().int().min(1).max(365),
  }),
});

export type Environment = z.infer<typeof schema>;
export type EnvironmentDefinition = (values: DeployValues) => Omit<z.input<typeof schema>, "name">;

export const defineEnvironment = (define: EnvironmentDefinition) => define;

export class EnvironmentError extends Error {}

export function parseEnvironment(
  name: string,
  define: EnvironmentDefinition,
  values: DeployValues,
): Environment {
  const result = schema.safeParse({ ...define(values), name });
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
  );
  throw new EnvironmentError(
    `The environment "${name}" is not complete. Set the values in packages/infra/.env.${name}:\n${problems.join("\n")}`,
  );
}

/** The deploy values: the file `.env.<name>`, with the process environment winning. Empty strings count as unset. */
export function readValues(
  name: string,
  processValues: Record<string, string | undefined> = process.env,
  folder: string = infraRoot,
): DeployValues {
  const file = join(folder, `.env.${name}`);
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const values: DeployValues = {};
  for (const key of VALUE_NAMES) {
    const value = (processValues[key] || fromFile[key])?.trim();
    if (value) values[key] = value;
  }
  return values;
}

/** Placeholders so `--dry-run` can show the scripts before any real value exists. */
export const DRY_RUN_VALUES: DeployValues = {
  DEPLOY_HOST: "vps.example.invalid",
  DEPLOY_DOMAIN: "zetta.example.invalid",
};

export async function loadDefinition(name: string): Promise<EnvironmentDefinition> {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name))
    throw new EnvironmentError(`"${name}" is not an environment name.`);
  const file = join(infraRoot, "environments", `${name}.ts`);
  if (!existsSync(file))
    throw new EnvironmentError(
      `There is no environment "${name}": add packages/infra/environments/${name}.ts.`,
    );
  return ((await import(file)) as { default: EnvironmentDefinition }).default;
}
