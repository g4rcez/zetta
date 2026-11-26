// Postgres on the same machine, reachable only through its Unix socket.
import type { Environment } from "../environment";
import { APP_USER, DATABASE, PATHS } from "../layout";
import { file, step, trackedFile } from "../shell";
import { majorUpgradeCheck, majorUpgradeHook, pgHba, postgresConf } from "../templates/postgres";

/** Migrations use `uuidv7()`, which Postgres has since version 18. */
const MINIMUM_MAJOR = 18;

export const postgresStep = (environment: Environment) => {
  const data = PATHS.pgData;
  return step(
    "postgres",
    "Postgres: socket only, role and database",
    `
cd /
major=$(postgres --version | awk '{ print $3 }' | cut -d. -f1)
[ "$major" -ge ${MINIMUM_MAJOR} ] || fail "Postgres $major is installed; Zetta needs ${MINIMUM_MAJOR} or newer"
${file({ path: "/usr/local/bin/zetta-pg-major-check", content: majorUpgradeCheck(), mode: "0755" })}
${file({ path: "/etc/pacman.d/hooks/00-zetta-postgres-major.hook", content: majorUpgradeHook() })}
if [ ! -f ${data}/PG_VERSION ]; then
  install -d -o postgres -g postgres -m 0700 ${data}
  runuser -u postgres -- initdb --pgdata=${data} --encoding=UTF8 --locale=C.UTF-8 --data-checksums \\
    --auth-local=peer --auth-host=scram-sha-256 >/dev/null
  changed "new database cluster in ${data}"
fi
RESTART=0
if ! grep -qE "^include_dir[[:space:]]*=[[:space:]]*'conf.d'" ${data}/postgresql.conf; then
  printf "\\ninclude_dir = 'conf.d'\\n" >>${data}/postgresql.conf
  changed "${data}/postgresql.conf"
  RESTART=1
fi
ensure_dir ${data}/conf.d 0700 postgres postgres
${trackedFile("RESTART", { path: `${data}/conf.d/zetta.conf`, content: postgresConf(environment), mode: "0600", owner: "postgres" })}
${trackedFile("RESTART", { path: `${data}/pg_hba.conf`, content: pgHba(), mode: "0600", owner: "postgres" })}
if [ "$RESTART" = 1 ] && systemctl is-active --quiet postgresql; then systemctl restart postgresql; changed "restarted postgresql"; fi
ensure_running postgresql

sql() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAq "$@"; }
if [ -z "$(sql -c "SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}'")" ]; then
  sql -c 'CREATE ROLE ${APP_USER} LOGIN'
  changed "database role ${APP_USER}"
fi
# A migration makes the role a superuser while it runs and takes that back; this repairs a run that was cut off in between.
if [ "$(sql -c "SELECT rolsuper FROM pg_roles WHERE rolname = '${APP_USER}'")" = t ]; then
  sql -c 'ALTER ROLE ${APP_USER} NOSUPERUSER'
  changed "${APP_USER} is no longer a superuser"
fi
if [ -z "$(sql -c "SELECT 1 FROM pg_database WHERE datname = '${DATABASE}'")" ]; then
  runuser -u postgres -- createdb --owner=${APP_USER} ${DATABASE}
  changed "database ${DATABASE}"
fi
`,
  );
};
