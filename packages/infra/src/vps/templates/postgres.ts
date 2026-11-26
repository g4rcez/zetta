import type { Environment } from "../environment";
import { APP_USER, DATABASE, PATHS } from "../layout";

export const postgresConf = ({ postgres }: Environment) => `# Managed by packages/infra.
# No TCP at all: the only way in is the Unix socket, from this machine.
listen_addresses = ''
unix_socket_directories = '/run/postgresql'
max_connections = ${postgres.maxConnections}
shared_buffers = ${postgres.sharedBuffers}
effective_cache_size = ${postgres.effectiveCacheSize}
work_mem = ${postgres.workMem}
maintenance_work_mem = ${postgres.maintenanceWorkMem}
wal_compression = on
random_page_cost = 1.1
effective_io_concurrency = 200
`;

/** Peer authentication only: the Linux user is the database user. */
export const pgHba = () => `# Managed by packages/infra.
# TYPE  DATABASE     USER        METHOD
local   all          postgres    peer
local   ${DATABASE}        ${APP_USER}       peer
local   all          all         reject
`;

/**
 * A pacman hook that stops an upgrade which would move Postgres to a new major version: the new server cannot open the old data folder.
 * Minor updates and library updates go through, so the system stays whole. Holding the packages instead would leave an old Postgres
 * linked against new libraries.
 */
export const majorUpgradeHook = () => `# Managed by packages/infra.
[Trigger]
Operation = Upgrade
Type = Package
Target = postgresql

[Action]
Description = Zetta: checking for a Postgres major upgrade
When = PreTransaction
Exec = /usr/local/bin/zetta-pg-major-check
AbortOnFail
`;

export const majorUpgradeCheck = () => `#!/usr/bin/env bash
# Managed by packages/infra. Fails when the repository's Postgres has another major version than the data folder.
set -euo pipefail
export LC_ALL=C
data=$(cat ${PATHS.pgData}/PG_VERSION 2>/dev/null) || exit 0
next=$(pacman -Si postgresql | awk '$1 == "Version" { print $3; exit }')
next=\${next##*:}
next=\${next%%[.-]*}
if [ -n "$next" ] && [ "$next" != "$data" ]; then
  cat >&2 <<MESSAGE
Postgres $next would replace Postgres $data, and the new server cannot open the current data folder.
Upgrade everything else now:   pacman -Syu --ignore postgresql,postgresql-libs,pgvector
Plan the major upgrade:        docs/operations/vps.md, "A Postgres major upgrade"
MESSAGE
  exit 1
fi
`;
