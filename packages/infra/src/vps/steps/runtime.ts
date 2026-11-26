// The programs Zetta runs on: Bun, the agent CLIs and, in the `podman` sandbox, the container a bot run gets.
import { createHash } from "node:crypto";
import type { Agent, Environment } from "../environment";
import { APP_USER, PATHS, SERVICE_PATH } from "../layout";
import { file, quote, step } from "../../core/shell";
import type { Versions } from "../../core/versions";

export const bunStep = (versions: Versions) =>
  step(
    "bun",
    `Bun ${versions.bun}`,
    `
version=${quote(versions.bun)}
if [ "$(${PATHS.bun} --version 2>/dev/null || true)" != "$version" ]; then
  case "$(uname -m)" in
    x86_64) if grep -qw avx2 /proc/cpuinfo; then target=bun-linux-x64; else target=bun-linux-x64-baseline; fi ;;
    aarch64) target=bun-linux-aarch64 ;;
    *) fail "Bun has no build for $(uname -m)" ;;
  esac
  work=$(mktemp -d)
  from="https://github.com/oven-sh/bun/releases/download/bun-v$version"
  curl -fsSL --retry 3 -o "$work/$target.zip" "$from/$target.zip"
  curl -fsSL --retry 3 -o "$work/SHASUMS256.txt" "$from/SHASUMS256.txt"
  (cd "$work" && grep " $target.zip\\$" SHASUMS256.txt | sha256sum -c --quiet -)
  unzip -q "$work/$target.zip" -d "$work"
  install -D -m 0755 "$work/$target/bun" ${PATHS.bun}
  ln -sfn ${PATHS.bun} /usr/local/bin/bun
  rm -rf "$work"
  changed "Bun $version"
fi
`,
  );

const AGENT_PROGRAMS: Record<Agent, string> = { "claude-code": "claude", codex: "codex" };

export const agentsStep = (environment: Environment, versions: Versions) =>
  step(
    "agents",
    "Agent CLIs",
    [
      `cd /
# Asked as the app user: a version in a package file says nothing about whether the program runs.
works() { runuser -u ${APP_USER} -- env HOME=${PATHS.home} PATH=${SERVICE_PATH} "$1" --version 2>/dev/null | grep -qF "$2"; }`,
      ...environment.agents.map((agent) => {
        const { package: name, version } = versions.agents[agent];
        const program = AGENT_PROGRAMS[agent];
        return `if ! works ${program} ${quote(version)}; then
  # npm runs no install script unless the package is named, and Claude Code puts its program in place with one.
  npm install --global --prefix ${PATHS.agents} --no-fund --no-audit --allow-scripts=${quote(name)} ${quote(`${name}@${version}`)}
  works ${program} ${quote(version)} || fail "${agent} ${version} was installed but does not run"
  changed "${agent} ${version}"
fi`;
      }),
    ].join("\n"),
  );

export const harnessImage = (versions: Versions) =>
  `zetta-harness:${createHash("sha256").update(versions.harnessDockerfile).digest("hex").slice(0, 12)}`;

/** Rootless Podman for the app user, with the user ids kept so a container reads the home folder mounted into it. */
export const podmanStep = (versions: Versions) => {
  const image = harnessImage(versions);
  const containers = `${PATHS.home}/.config/containers`;
  return step(
    "podman",
    "Rootless Podman and the bot run image",
    `
cd /
if ! grep -q '^${APP_USER}:' /etc/subuid; then
  usermod --add-subuids 200000-265535 --add-subgids 200000-265535 ${APP_USER}
  changed "user id range for ${APP_USER}"
fi
uid=$(id -u ${APP_USER})
DELEGATE=0
${file({ path: "/etc/systemd/system/user@.service.d/zetta-delegate.conf", content: "[Service]\nDelegate=cpu cpuset io memory pids\n" })}
DELEGATE=$WROTE
if [ "$DELEGATE" = 1 ]; then systemctl daemon-reload; fi
if [ ! -f /var/lib/systemd/linger/${APP_USER} ]; then loginctl enable-linger ${APP_USER}; changed "linger for ${APP_USER}"; fi
systemctl start "user@$uid.service"
for folder in ${PATHS.home}/.config ${containers} ${PATHS.harnessHomes}; do
  ensure_dir "$folder" 0700 ${APP_USER} ${APP_USER}
done
${file({ path: `${containers}/containers.conf`, content: '[containers]\nuserns = "keep-id"\n', mode: "0600", owner: APP_USER })}
put_file ${PATHS.sandboxEnv} 0644 root root < <(printf 'XDG_RUNTIME_DIR=/run/user/%s\\n' "$uid")
as_app() { runuser -u ${APP_USER} -- env --chdir=${PATHS.home} HOME=${PATHS.home} XDG_RUNTIME_DIR="/run/user/$uid" "$@"; }
if ! as_app podman image exists localhost/${image}; then
  context=$(mktemp -d)
  cat >"$context/Dockerfile" <<'__IMAGE__'
${versions.harnessDockerfile.trimEnd()}
__IMAGE__
  chown -R ${APP_USER}: "$context"
  as_app podman build --tag ${image} --tag zetta-harness:latest "$context"
  rm -rf "$context"
  changed "image ${image}"
fi
`,
  );
};
