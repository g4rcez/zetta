// Files that configure Zetta and the services around it.
import type { Environment } from "../environment";
import { APP_PORT, APP_USER, DATABASE, DATABASE_URL, PATHS, SERVICE_PATH } from "../layout";

/** The non-secret settings. The secrets are in a second file that is generated on the server and never rewritten. */
export function appEnv(environment: Environment): string {
  const lines = [
    "# Managed by packages/infra. Edit the environment definition, then run bootstrap.",
    "NODE_ENV=production",
    `PATH=${SERVICE_PATH}`,
    `ZETTA_SERVER_URL=https://${environment.domain}`,
    "ZETTA_HOST=127.0.0.1",
    `PORT=${APP_PORT}`,
    `ZETTA_HOME=${PATHS.home}`,
    `ZETTA_WEB_DIST=${PATHS.current}/apps/web/dist`,
    `DATABASE_URL=${DATABASE_URL}`,
    `ZETTA_DB_POOL_MAX=${environment.postgres.appPool}`,
    "ZETTA_COOKIE_SAMESITE=lax",
    "ZETTA_TRUSTED_IP_HEADER=x-forwarded-for",
    // The local intent model takes about 2 GB: it must not load at boot on a small server.
    "ZETTA_LAYA_PRELOAD=0",
    // Updates come from `infra deploy`; the built-in notice would tell the administrator to run the Docker installer.
    "ZETTA_UPDATE_CHECK=off",
  ];
  if (environment.sandbox === "podman")
    lines.push(
      "ZETTA_HARNESS_RUNTIME=docker",
      "ZETTA_DOCKER_BIN=podman",
      "ZETTA_CONTAINER_ENGINE=podman",
      `ZETTA_HARNESS_HOME_ROOT=${PATHS.harnessHomes}`,
    );
  return `${lines.join("\n")}\n`;
}

export function serviceUnit(environment: Environment): string {
  // Rootless Podman needs its setuid helpers, its runtime folder under /run/user and the same /tmp as the containers' mounts.
  const isolation =
    environment.sandbox === "podman"
      ? `EnvironmentFile=${PATHS.sandboxEnv}`
      : `NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true`;
  return `# Managed by packages/infra.
[Unit]
Description=Zetta server
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${PATHS.current}/apps/server
EnvironmentFile=${PATHS.appEnv}
EnvironmentFile=${PATHS.secretsEnv}
EnvironmentFile=-${PATHS.current}/release.env
ExecStart=${PATHS.bun} dist/index.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65536
MemoryHigh=${environment.service.memoryHigh}
MemoryMax=${environment.service.memoryMax}
# A bot's process that runs out of memory is killed alone; the server keeps running.
OOMPolicy=continue
ProtectSystem=full
ReadWritePaths=${PATHS.home}
${isolation}

[Install]
WantedBy=multi-user.target
`;
}

export function caddyfile(environment: Environment): string {
  const global = environment.acmeEmail ? `{\n\temail ${environment.acmeEmail}\n}\n\n` : "";
  return `# Managed by packages/infra.
${global}${environment.domain} {
	# Live updates (/api/events) are a stream: the API is never compressed or buffered here.
	@page not path /api/*
	encode @page zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	reverse_proxy 127.0.0.1:${APP_PORT} {
		flush_interval -1
	}
}
`;
}

export const backupUnit = () => `# Managed by packages/infra.
[Unit]
Description=Back up Zetta
Requires=postgresql.service
After=postgresql.service

[Service]
Type=oneshot
ExecStart=${PATHS.backupScript} scheduled
Nice=10
IOSchedulingClass=idle
`;

export const backupTimer = () => `# Managed by packages/infra.
[Unit]
Description=Nightly Zetta backup

[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
`;

/** A database dump and the files, in a folder per run. Each kind is counted apart, so deploys never push out the nightly ones. */
export const backupScript = (environment: Environment) => `#!/usr/bin/env bash
# Managed by packages/infra. Usage: zetta-backup [scheduled|deploy|restore]
set -euo pipefail
export LC_ALL=C
umask 077
kind=\${1:-scheduled}
case "$kind" in scheduled | deploy | restore) ;; *) echo "usage: zetta-backup [scheduled|deploy|restore]" >&2; exit 2 ;; esac
folder=${PATHS.backups}/$kind
name=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$folder"
work="$folder/.$name.partial"
rm -rf "$work"
mkdir "$work"
trap 'rm -rf "$work"' EXIT
runuser -u postgres -- pg_dump -Fc ${DATABASE} >"$work/database.dump"
pg_restore --list "$work/database.dump" >/dev/null
# Model downloads and container images are left out: they download again. Files may change while tar reads them (status 1).
status=0
tar -C /var/lib --exclude=zetta/cache --exclude=zetta/.cache --exclude=zetta/.npm --exclude=zetta/.bun --exclude=zetta/.local/share/containers \\
  --warning=no-file-changed --warning=no-file-removed -czf "$work/files.tar.gz" zetta || status=$?
[ "$status" -le 1 ] || exit "$status"
mv "$work" "$folder/$name"
trap - EXIT
find "$folder" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort -r | tail -n +${environment.keep.backups + 1} | xargs -r rm -rf --
echo "$folder/$name"
`;

/** Puts a backup back. It takes a backup of the current state first, in its own bucket, so nothing is lost by running it. */
export const restoreScript = () => `#!/usr/bin/env bash
# Managed by packages/infra. Usage: zetta-restore <backup folder>
set -euo pipefail
export LC_ALL=C
backup=\${1:-}
if [ ! -f "$backup/database.dump" ] || [ ! -f "$backup/files.tar.gz" ]; then
  echo "usage: zetta-restore <backup folder>   (folders are under ${PATHS.backups})" >&2
  exit 2
fi
backup=$(realpath "$backup")
pg_restore --list "$backup/database.dump" >/dev/null
${PATHS.backupScript} restore
systemctl stop zetta
as_postgres() { runuser -u postgres -- "$@"; }
as_postgres dropdb --force --if-exists ${DATABASE}
as_postgres createdb --owner=${APP_USER} ${DATABASE}
# The dump creates the extensions and every object: for the length of the restore the app role may do that.
trap 'as_postgres psql -qc "ALTER ROLE ${APP_USER} NOSUPERUSER"' EXIT
as_postgres psql -v ON_ERROR_STOP=1 -qc "ALTER ROLE ${APP_USER} SUPERUSER"
runuser -u ${APP_USER} -- pg_restore --exit-on-error --dbname=${DATABASE} <"$backup/database.dump"
as_postgres psql -v ON_ERROR_STOP=1 -qc "ALTER ROLE ${APP_USER} NOSUPERUSER"
trap - EXIT
# Settings of the database itself are not part of a dump.
as_postgres psql -v ON_ERROR_STOP=1 -qc "ALTER DATABASE ${DATABASE} SET search_path TO zetta"
as_postgres psql -v ON_ERROR_STOP=1 -qc "REVOKE CREATE, TEMPORARY ON DATABASE ${DATABASE} FROM PUBLIC"
# Files are written over the current ones; files made after the backup stay.
tar -C /var/lib -xzf "$backup/files.tar.gz"
systemctl start zetta
echo "restored $backup"
`;
