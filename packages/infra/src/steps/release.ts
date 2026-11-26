// The remote half of a deploy and the day-to-day commands.
import { APP_PORT, APP_USER, DATABASE_URL, PATHS, RELEASE_ID } from "../layout";
import { quote, step } from "../shell";

function releaseId(id: string) {
  if (!RELEASE_ID.test(id)) throw new Error(`"${id}" is not a release id.`);
  return id;
}

/** Seconds the new server has to answer `/readyz` before the previous release comes back. */
const READY_SECONDS = 150;

const LIST = `find ${PATHS.releases} -mindepth 1 -maxdepth 1 -type d -name '2*Z-*' ! -name '*.partial' ! -name '*.failed' -printf '%f\\n' | sort`;

/** Fails early, before a long build, when the server was never bootstrapped. Runs as root. */
export const preflightStep = () =>
  step(
    "preflight",
    "The server is bootstrapped",
    `
[ -f ${PATHS.appEnv} ] && [ -x ${PATHS.bun} ] && [ -d ${PATHS.releases} ] || fail "run bootstrap first"
free=$(df -Pm ${PATHS.releases} | awk 'NR == 2 { print $4 }')
[ "$free" -ge 3072 ] || fail "only $free MB are free under ${PATHS.releases}; a release needs about 3 GB while it installs"
`,
  );

/** Runs as the admin user, which owns the releases: the upload goes into this folder. */
export const prepareStep = (id: string) =>
  step(
    "prepare",
    `Folder for release ${releaseId(id)}`,
    `
rm -rf ${PATHS.releases}/*.partial ${PATHS.releases}/*.failed
mkdir ${PATHS.releases}/${id}.partial
changed "${PATHS.releases}/${id}.partial"
`,
  );

/** Runs as the admin user. Dependencies are installed here: the native modules must be Linux builds. */
export const installStep = (id: string) =>
  step(
    "install",
    "Dependencies of the server",
    `
cd ${PATHS.releases}/${releaseId(id)}.partial
${PATHS.bun} install --frozen-lockfile --production --filter server --filter @zetta/db
# The app user reads the release, whatever the umask of the computer that uploaded it was.
chmod -R a+rX .
cd ${PATHS.releases}
mv ${id}.partial ${id}
changed "release ${id}"
`,
  );

export const backupStep = () =>
  step(
    "backup",
    "Backup of the database and files",
    `
made=$(${PATHS.backupScript} scheduled)
changed "$made"
`,
  );

/**
 * Runs as root; `release` is a folder name or "current". With migrations waiting: Zetta stops, a backup is taken, and the app role is
 * a superuser for as long as the migrator runs (some migrations move extensions, which needs one). Nothing of Zetta, bots included,
 * is running then. However it ends, the role loses that again and the release that was current starts: a failed migration is rolled
 * back, so the old code goes on working.
 */
export const migrateStep = (release: string) => {
  const folder = release === "current" ? PATHS.current : `${PATHS.releases}/${releaseId(release)}`;
  return step(
    "migrate",
    "Database migrations, after a backup",
    `
cd ${folder}
migrator() {
  runuser -u ${APP_USER} -- env HOME=${PATHS.home} DATABASE_URL=${quote(DATABASE_URL)} ${PATHS.bun} packages/db/scripts/migrate.ts "$@"
}
sql() { (cd / && runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAq "$@"); }
pending=$(migrator --pending)
if [ "$pending" = 0 ]; then
  note "no migrations waiting"
else
  note "$pending migrations waiting"
  close() {
    sql -c 'ALTER ROLE ${APP_USER} NOSUPERUSER'
    if [ -e ${PATHS.current} ]; then systemctl start zetta; fi
  }
  trap close EXIT
  systemctl stop zetta 2>/dev/null || true
  made=$(${PATHS.backupScript} deploy)
  changed "backup $made"
  sql -c 'ALTER ROLE ${APP_USER} SUPERUSER'
  migrator
  changed "database migrated"
  close
  trap - EXIT
  [ "$(sql -c "SELECT rolsuper FROM pg_roles WHERE rolname = '${APP_USER}'")" = f ] || fail "the role ${APP_USER} is still a superuser"
fi
`,
  );
};

// Points `current` at $target, restarts, and goes back to the release that ran before when the new one does not answer.
const SWITCH = `
cd /
previous=$(readlink ${PATHS.current} 2>/dev/null || true)
point_at() { ln -sfn "$1" ${PATHS.current}.next; mv -T ${PATHS.current}.next ${PATHS.current}; }
ready() {
  for _ in $(seq 1 ${READY_SECONDS}); do
    if curl -fsS --max-time 2 http://127.0.0.1:${APP_PORT}/readyz >/dev/null 2>&1; then return 0; fi
    # systemd gave up restarting it: waiting longer changes nothing.
    if systemctl is-failed --quiet zetta; then return 1; fi
    sleep 1
  done
  return 1
}
restart() { systemctl reset-failed zetta 2>/dev/null || true; systemctl restart zetta; }
point_at "$target"
if restart && ready; then
  changed "running $(basename "$target")"
else
  journalctl -u zetta -n 80 --no-pager >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$target" ] && [ -d "$previous" ]; then
    point_at "$previous"
    if restart && ready; then
      # A new release that never ran is set aside, so a later rollback does not pick it.
      if [ "$new_release" = 1 ]; then mv "$target" "$target.failed"; fi
      fail "$(basename "$target") did not become ready; $(basename "$previous") is running again"
    fi
    fail "$(basename "$target") did not become ready, and neither did $(basename "$previous")"
  fi
  fail "$(basename "$target") did not become ready"
fi`;

export const activateStep = (id: string) =>
  step(
    "activate",
    "Switch to the new release",
    `
target=${PATHS.releases}/${releaseId(id)}
[ -d "$target" ] || fail "there is no release ${id}"
new_release=1
${SWITCH}
`,
  );

/** `to` is a release id or part of one (a commit). Without it, the release before the current one. */
export function rollbackStep(to?: string) {
  if (to !== undefined && !/^[0-9A-Za-z-]{4,60}$/.test(to))
    throw new Error(`"${to}" is not a release id or a commit.`);
  const find = to
    ? `name=$(${LIST} | grep -F -- ${quote(to)} | tail -n 1 || true)
[ -n "$name" ] || fail "no release matches ${to}"`
    : `current=$(basename "$(readlink ${PATHS.current} 2>/dev/null || true)")
name=$(${LIST} | awk -v current="$current" '$0 < current' | tail -n 1)
[ -n "$name" ] || fail "there is no release older than the current one"`;
  return step(
    "rollback",
    "Go back to an earlier release",
    `
${find}
target=${PATHS.releases}/$name
note "migrations are not undone"
new_release=0
${SWITCH}
`,
  );
}

/** Runs as the admin user. The release that is running is never removed. */
export const pruneStep = (keep: number) =>
  step(
    "prune",
    `Keep the newest ${keep} releases`,
    `
current=$(basename "$(readlink ${PATHS.current} 2>/dev/null || true)")
for name in $(${LIST} | sort -r | tail -n +${keep + 1}); do
  if [ "$name" != "$current" ]; then
    rm -rf -- "${PATHS.releases}/$name"
    changed "removed $name"
  fi
done
`,
  );

export const restartStep = () =>
  step(
    "restart",
    "Restart Zetta",
    `
[ -e ${PATHS.current} ] || fail "nothing is deployed"
target=$(readlink ${PATHS.current})
new_release=0
${SWITCH}
`,
  );

export const statusStep = () =>
  step(
    "status",
    "Status",
    `
CHANGED=1
for unit in zetta caddy postgresql zetta-backup.timer sshguard; do
  printf '    %-20s %s\\n' "$unit" "$(systemctl is-active "$unit" || true)"
done
if nft list table inet zetta >/dev/null 2>&1; then note "firewall             loaded"; else note "firewall             NOT loaded"; fi
if curl -fsS --max-time 3 http://127.0.0.1:${APP_PORT}/readyz >/dev/null 2>&1; then note "ready: yes"; else note "ready: NO"; fi
note "memory of the zetta service: $(systemctl show zetta -p MemoryCurrent --value | numfmt --to=iec 2>/dev/null || echo unknown)"
free -h
df -h /
current=$(basename "$(readlink ${PATHS.current} 2>/dev/null || true)")
note "releases:"
for name in $(${LIST}); do
  if [ "$name" = "$current" ]; then note "  $name  <- running"; else note "  $name"; fi
done
note "newest backups:"
find ${PATHS.backups} -mindepth 2 -maxdepth 2 -type d -name '2*' -printf '%f %p\\n' 2>/dev/null | sort | tail -n 3 | while read -r _ path; do
  note "  $path ($(du -sh "$path" | cut -f1))"
done
`,
  );

/** Prints only the path of the newest backup of any kind. */
export const NEWEST_BACKUP = `find ${PATHS.backups} -mindepth 2 -maxdepth 2 -type d -name '2*' -printf '%f %p\\n' | sort | tail -n 1 | cut -d' ' -f2-`;
