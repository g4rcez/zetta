// Zetta itself: its user, folders, settings, secrets, units and the web server in front of it.
import type { Environment } from "../environment";
import { APP_USER, PATHS } from "../layout";
import { step, trackedFile } from "../../core/shell";
import {
  appEnv,
  backupScript,
  backupTimer,
  backupUnit,
  caddyfile,
  restoreScript,
  serviceUnit,
} from "../templates/app";

/** Generated on the server on the first run and never rewritten: replacing them loses sealed data or signs everyone out. */
export const SECRET_NAMES = ["BETTER_AUTH_SECRET", "ZETTA_CONNECTION_KEY", "ZETTA_SETUP_KEY"];

export const appUserStep = (environment: Environment) => {
  const admin = environment.ssh.user;
  return step(
    "app-user",
    "The zetta user, folders and secrets",
    `
if ! id -u ${APP_USER} >/dev/null 2>&1; then
  # A real shell: bots run commands as this user. It has no password and sshd refuses it.
  useradd --system --user-group --create-home --home-dir ${PATHS.home} --shell /bin/bash ${APP_USER}
  usermod -p '*' ${APP_USER}
  changed "user ${APP_USER}"
fi
ensure_dir ${PATHS.home} 0750 ${APP_USER} ${APP_USER}
group=$(id -gn ${admin})
ensure_dir ${PATHS.root} 0755 ${admin} "$group"
ensure_dir ${PATHS.releases} 0755 ${admin} "$group"
ensure_dir ${PATHS.config} 0755 root root
ensure_dir ${PATHS.backups} 0700 root root
umask 077
touch ${PATHS.secretsEnv}
for name in ${SECRET_NAMES.join(" ")}; do
  if ! grep -q "^$name=" ${PATHS.secretsEnv}; then
    value=$(openssl rand -base64 32)
    printf '%s=%s\\n' "$name" "$value" >>${PATHS.secretsEnv}
    changed "secret $name"
  fi
done
chown root:root ${PATHS.secretsEnv}
chmod 600 ${PATHS.secretsEnv}
umask 022
`,
  );
};

export const caddyStep = (environment: Environment) => {
  const config = caddyfile(environment);
  return step(
    "caddy",
    `Caddy: HTTPS for ${environment.domain}`,
    `
check=$(mktemp)
cat >"$check" <<'__CADDY__'
${config.trimEnd()}
__CADDY__
caddy validate --adapter caddyfile --config "$check" >/dev/null 2>&1 || {
  caddy validate --adapter caddyfile --config "$check" || true
  fail "the Caddyfile is not valid"
}
rm -f "$check"
CADDY=0
${trackedFile("CADDY", { path: "/etc/caddy/Caddyfile", content: config })}
if [ "$CADDY" = 1 ] && systemctl is-active --quiet caddy; then systemctl reload caddy; changed "reloaded caddy"; fi
ensure_running caddy
`,
  );
};

export const servicesStep = (environment: Environment) =>
  step(
    "services",
    "Zetta units, settings and nightly backups",
    `
APP=0
UNITS=0
${trackedFile("APP", { path: PATHS.appEnv, content: appEnv(environment) })}
${trackedFile("APP", { path: "/etc/systemd/system/zetta.service", content: serviceUnit(environment) })}
${trackedFile("UNITS", { path: "/etc/systemd/system/zetta-backup.service", content: backupUnit() })}
${trackedFile("UNITS", { path: "/etc/systemd/system/zetta-backup.timer", content: backupTimer() })}
${trackedFile("UNITS", { path: PATHS.backupScript, content: backupScript(environment), mode: "0755" })}
${trackedFile("UNITS", { path: PATHS.restoreScript, content: restoreScript(), mode: "0755" })}
if [ "$((APP | UNITS))" = 1 ]; then systemctl daemon-reload; fi
if ! systemctl is-enabled --quiet zetta; then systemctl enable --quiet zetta; changed "enabled zetta"; fi
ensure_running zetta-backup.timer
# Before the first deploy there is nothing to start.
if [ -e ${PATHS.current} ]; then
  if [ "$APP" = 1 ]; then systemctl restart zetta; changed "restarted zetta"; else ensure_running zetta; fi
fi
`,
  );
