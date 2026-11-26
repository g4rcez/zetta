// Where everything lives on the server. The steps, the units and the CLI all read these names.

export const APP_USER = "zetta";
export const DATABASE = "zetta";

export const PATHS = {
  /** Code: `releases/<id>` and the `current` link to the one that runs. Owned by the admin user. */
  root: "/srv/zetta",
  releases: "/srv/zetta/releases",
  current: "/srv/zetta/current",
  /** Data: the app user's home and `ZETTA_HOME`. */
  home: "/var/lib/zetta",
  config: "/etc/zetta",
  appEnv: "/etc/zetta/zetta.env",
  secretsEnv: "/etc/zetta/secrets.env",
  sandboxEnv: "/etc/zetta/sandbox.env",
  backups: "/var/backups/zetta",
  harnessHomes: "/var/lib/zetta/harness-homes",
  bun: "/opt/bun/bin/bun",
  agents: "/opt/agents",
  pgData: "/var/lib/postgres/data",
  backupScript: "/usr/local/bin/zetta-backup",
  restoreScript: "/usr/local/bin/zetta-restore",
} as const;

export const APP_PORT = 3000;

/** Peer authentication over the Unix socket: no password, and no TCP port to close. */
export const DATABASE_URL = `postgresql://${APP_USER}@/${DATABASE}?host=/run/postgresql`;

export const SERVICE_PATH = `${PATHS.agents}/bin:/opt/bun/bin:/usr/local/bin:/usr/bin`;

/** Release ids sort by time: `<UTC stamp>-<short commit>`. */
export const RELEASE_ID = /^\d{8}T\d{6}Z-[0-9a-f]{7,40}$/;
