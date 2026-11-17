#!/usr/bin/env bash
# Zetta installer: curl -fsSL https://zettabot.app/install | bash
# Clones the repository, checks the computer, writes the .env files and starts the containers. The same steps as "Run it on your server" on the
# landing page. Run it again to update: it pulls the code, keeps your .env files and your data.
#
#   ZETTA_DIR   the install folder (default: $HOME/zetta)
#   --url URL   the public address people will use, for example https://zetta.example.com (default: http://localhost:3001). Changing it on an
#               existing install updates it everywhere, then rebuilds.
#   --port N    the port the web app listens on (default 3001), when 3001 is taken.
#   Pass options through the pipe:  curl -fsSL https://zettabot.app/install | bash -s -- --url https://zetta.example.com
#
# All code is inside main(), called on the last line, so a download that stops half way runs nothing. It also works with the macOS bash (3.2).
set -euo pipefail

REPO_URL="${ZETTA_REPO_URL:-https://github.com/g4rcez/zetta.git}"
# Room the install folder needs, in MB. The container images need about 6 GB more, in the container engine's own storage.
MIN_FREE_MB="${ZETTA_INSTALL_MIN_FREE_MB:-3072}"

say() {
  echo "▶ $*"
}

# fail "what went wrong" ["what to do about it"]
fail() {
  echo "error: $1" >&2
  [ -z "${2:-}" ] || echo "       $2" >&2
  exit 1
}

# Same runtime detection as scripts/zetta.sh.
find_runtime() {
  local runtime
  for runtime in docker podman; do
    if command -v "$runtime" >/dev/null 2>&1 && "$runtime" info >/dev/null 2>&1; then
      echo "$runtime"
      return 0
    fi
  done
  return 1
}

secret() {
  openssl rand -base64 32
}

# "https://zetta.example.com/" -> "https://zetta.example.com": an address with a scheme and a host (and a port), nothing after it.
normalize_url() {
  local url="${1%/}"
  case "$url" in
  http://* | https://*) ;;
  *) return 1 ;;
  esac
  local rest="${url#*://}"
  case "$rest" in
  "" | */* | *\ * | *\?* | *\#*) return 1 ;;
  esac
  echo "$url"
}

# True when something already listens on this port of this computer.
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# env_value FILE KEY: the value of KEY in an env file, or nothing.
env_value() {
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1 | tr -d "\"'"
}

# set_env FILE KEY VALUE: replaces the line of KEY, or adds it. Private file, like the ones the installer writes.
set_env() {
  local file="$1" key="$2" value="$3" temp
  temp=$(mktemp)
  if [ -f "$file" ] && grep -q "^$key=" "$file"; then
    awk -v key="$key" -v value="$value" 'BEGIN { FS = OFS = "=" } $1 == key { print key "=" value; next } { print }' "$file" >"$temp"
  else
    { [ ! -f "$file" ] || cat "$file"; echo "$key=$value"; } >"$temp"
  fi
  chmod 600 "$temp"
  mv "$temp" "$file"
}

parse_args() {
  PUBLIC_URL=""
  WEB_PORT=""
  while [ $# -gt 0 ]; do
    case "$1" in
    --url)
      [ $# -ge 2 ] || fail "--url needs an address" "For example: --url https://zetta.example.com"
      PUBLIC_URL=$(normalize_url "$2") ||
        fail "\"$2\" is not an address Zetta can use" "Write it with http:// or https://, the host and no path: https://zetta.example.com"
      shift 2
      ;;
    --port)
      [ $# -ge 2 ] || fail "--port needs a number"
      case "$2" in
      '' | *[!0-9]*) fail "\"$2\" is not a port number" ;;
      esac
      WEB_PORT="$2"
      shift 2
      ;;
    -h | --help)
      # Piped from curl, $0 is "bash": there is no file to read the help from.
      if [ -f "$0" ]; then sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; else echo "Options: --url ADDRESS, --port NUMBER. See https://zettabot.app/install"; fi
      exit 0
      ;;
    *) fail "unknown option: $1" "Options: --url ADDRESS, --port NUMBER" ;;
    esac
  done
}

check_computer() {
  case "$(uname -s)" in
  Darwin | Linux) ;;
  *) fail "this installer supports macOS, Linux and WSL." "On Windows, run it inside WSL." ;;
  esac
  command -v git >/dev/null 2>&1 || fail "git is not installed" "Install git, then run this again."
  command -v openssl >/dev/null 2>&1 || fail "openssl is not installed" "Install openssl, then run this again."
}

# check_runtime: sets CONTAINER to docker or podman.
check_runtime() {
  if ! CONTAINER=$(find_runtime); then
    if command -v docker >/dev/null 2>&1 || command -v podman >/dev/null 2>&1; then
      fail "docker or podman is installed but not running" "Start it (open Docker Desktop, or run: podman machine start), then run this again."
    fi
    fail "docker or podman is not installed" "Install Docker Desktop (https://www.docker.com/products/docker-desktop) or Podman, then run this again."
  fi
  "$CONTAINER" compose version >/dev/null 2>&1 ||
    fail "$CONTAINER compose is not available" "Update Docker Desktop, or install the compose plugin for $CONTAINER."
}

# check_disk DIR: DIR is the install folder, which may not exist yet: look at the closest folder that does.
check_disk() {
  local path="$1" free
  while [ ! -d "$path" ] && [ "$path" != "/" ]; do path=$(dirname "$path"); done
  free=$(df -Pk "$path" 2>/dev/null | awk 'NR == 2 { print int($4 / 1024) }')
  case "$free" in '' | *[!0-9]*) return 0 ;; esac
  if [ "$free" -lt "$MIN_FREE_MB" ]; then
    fail "only $free MB are free in $path (Zetta needs about $MIN_FREE_MB MB there)" "Free some space or set ZETTA_DIR to a folder on a bigger disk. The container images need about 6 GB more."
  fi
}

# check_ports PORT...: only on a first install or when the stack is not running: a running Zetta holds its own ports.
check_ports() {
  local port
  for port in "$@"; do
    if port_busy "$port"; then
      fail "port $port is already in use on this computer" "Stop what uses it, or choose another: run this again with --port <number> (the web app) or set ZETTA_API_PORT in $DIR/.env."
    fi
  done
}

stack_running() {
  [ -d "$DIR" ] && [ -n "$(cd "$DIR" && "$CONTAINER" compose ps -q 2>/dev/null || true)" ]
}

# The first container layout kept the server's files inside the container, so an update erased them. The new layout keeps them on the
# zetta_data volume. On the update that introduces it, copy them out of the running container (it is replaced next) and back in afterwards.
RESCUED=""
rescue_old_files() {
  local id rescue="$DIR/.zetta-old-files" pair
  id=$(cd "$DIR" && "$CONTAINER" compose ps -q server 2>/dev/null | head -n 1 || true)
  [ -n "$id" ] || return 0
  if "$CONTAINER" volume inspect zetta_zetta_data >/dev/null 2>&1; then return 0; fi
  say "Saving the files of the running server (they are moved to the new data volume after the update)"
  mkdir -p "$rescue"
  for pair in /root/.zetta:home/.zetta /root/.claude:home/.claude /root/.codex:home/.codex /root/.cache/zetta:home/.cache/zetta /app/apps/server/.zetta-files:files; do
    mkdir -p "$(dirname "$rescue/${pair#*:}")"
    "$CONTAINER" cp "$id:${pair%%:*}" "$rescue/${pair#*:}" >/dev/null 2>&1 || true
  done
  if [ -n "$(find "$rescue" -type f 2>/dev/null | head -n 1)" ]; then RESCUED="$rescue"; else rm -rf "$rescue"; fi
}

restore_old_files() {
  [ -n "$RESCUED" ] || return 0
  local name target
  say "Moving the saved files into the new data volume"
  for name in home/.zetta home/.claude home/.codex home/.cache/zetta files; do
    [ -d "$RESCUED/$name" ] || continue
    case "$name" in files) target=/data/files ;; *) target="/data/${name}" ;; esac
    (cd "$DIR" && "$CONTAINER" compose exec -T server mkdir -p "$target" && "$CONTAINER" compose cp "$RESCUED/$name/." "server:$target") ||
      echo "warning: could not move $name. The saved copy is still in $RESCUED" >&2
  done
  echo "  The saved copy stays in $RESCUED. Delete it when you have checked that everything is there."
}

# wait_ready: true once the web app answers on its public port and forwards /api/meta to the server.
wait_ready() {
  local probe="http://127.0.0.1:$1/api/meta" attempt=0
  command -v curl >/dev/null 2>&1 || {
    say "curl is not installed, so the installer cannot check that Zetta answers"
    return 0
  }
  while [ "$attempt" -lt "${ZETTA_INSTALL_WAIT_ATTEMPTS:-90}" ]; do
    if curl -fsS -m 3 "$probe" >/dev/null 2>&1; then return 0; fi
    attempt=$((attempt + 1))
    sleep "${ZETTA_INSTALL_POLL_SECONDS:-2}"
  done
  return 1
}

main() {
  parse_args "$@"
  check_computer
  check_runtime

  DIR="${ZETTA_DIR:-$HOME/zetta}"
  check_disk "$DIR"

  local fresh=0
  if [ ! -e "$DIR" ]; then
    fresh=1
  elif ! git -C "$DIR" remote get-url origin 2>/dev/null | grep -q "g4rcez/zetta"; then
    fail "$DIR exists and is not a Zetta clone" "Set ZETTA_DIR to another folder."
  fi

  # The web port: --port, else the one this install already uses, else 3001.
  local root_env="$DIR/.env" server_env="$DIR/apps/server/.env" web_env="$DIR/apps/web/.env"
  # A variable in the environment wins over the .env file, as it does for docker compose.
  local port="${WEB_PORT:-${ZETTA_WEB_PORT:-$(env_value "$root_env" ZETTA_WEB_PORT)}}"
  port="${port:-3001}"
  local api_port="${ZETTA_API_PORT:-$(env_value "$root_env" ZETTA_API_PORT)}"
  api_port="${api_port:-3000}"

  # Ports only matter when nothing of ours holds them.
  if [ "$fresh" = 1 ] || ! stack_running; then
    check_ports "$port" "$api_port"
  fi

  if [ "$fresh" = 1 ]; then
    say "Cloning Zetta into $DIR"
    git clone "$REPO_URL" "$DIR"
  else
    say "Updating Zetta in $DIR"
    git -C "$DIR" pull --ff-only
  fi

  # The public address: --url, else what this install already uses, else this computer on the chosen port.
  local url="$PUBLIC_URL"
  [ -n "$url" ] || url=$(env_value "$server_env" ZETTA_SERVER_URL)
  [ -n "$url" ] || url="http://localhost:$port"

  # Never overwrite a secret that is already there: the secrets in the .env files protect data that is already stored.
  local setup_key=""
  mkdir -p "$DIR/apps/server" "$DIR/apps/web"
  if [ ! -f "$server_env" ]; then
    say "Writing apps/server/.env"
    setup_key=$(secret)
    (
      umask 077
      cat >"$server_env" <<EOF
BETTER_AUTH_SECRET=$(secret)
ZETTA_SERVER_URL=$url
ZETTA_CONNECTION_KEY=$(secret)
ZETTA_SETUP_KEY=$setup_key
EOF
    )
  elif [ -n "$PUBLIC_URL" ]; then
    set_env "$server_env" ZETTA_SERVER_URL "$url"
  fi
  if [ ! -f "$web_env" ]; then
    say "Writing apps/web/.env"
    (umask 077 && echo "ZETTA_SERVER_URL=$url" >"$web_env")
  elif [ -n "$PUBLIC_URL" ]; then
    set_env "$web_env" ZETTA_SERVER_URL "$url"
  fi
  # The .env next to docker-compose.yml: what compose itself reads (the web build's address and the ports). A new install also gets its own
  # database password; an older one keeps the default, because Postgres only reads the password when it first creates the database.
  if [ ! -f "$root_env" ]; then
    say "Writing .env"
    (
      umask 077
      {
        echo "ZETTA_SERVER_URL=$url"
        echo "ZETTA_WEB_PORT=$port"
        [ "$fresh" = 0 ] || echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
      } >"$root_env"
    )
  else
    [ -z "$PUBLIC_URL" ] || set_env "$root_env" ZETTA_SERVER_URL "$url"
    [ -z "$WEB_PORT" ] || set_env "$root_env" ZETTA_WEB_PORT "$port"
  fi

  case "$url" in
  http://localhost* | http://127.0.0.1* | https://*) ;;
  *) echo "warning: $url is not https. Sign-in from other computers and the plugins that use OAuth (Google, MCP clients) need https." >&2 ;;
  esac

  [ "$fresh" = 1 ] || rescue_old_files

  say "Building and starting the containers (the first build takes several minutes)"
  # The commit and its date go into the server image as build arguments (docker-compose.yml), so Studio can say which version runs and
  # the daily update check can compare it with the published changelog. A git failure leaves them empty: the version is then unknown.
  local commit date
  commit=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || true)
  date=$(git -C "$DIR" log -1 --format=%cI 2>/dev/null || true)
  (cd "$DIR" && ZETTA_BUILD_COMMIT="$commit" ZETTA_BUILD_DATE="$date" "$CONTAINER" compose up -d --build)

  say "Waiting for Zetta to answer"
  if ! wait_ready "$port"; then
    echo "error: the containers started, but Zetta did not answer on port $port within the time allowed." >&2
    echo "       Look at what the server says:  cd \"$DIR\" && $CONTAINER compose logs --tail 60 server" >&2
    exit 1
  fi
  restore_old_files

  cat <<EOF

Zetta is running.
  1. Open $url
EOF
  if [ -n "$setup_key" ]; then
    cat <<EOF
  2. Paste this setup key when it asks (it is also in $server_env as ZETTA_SETUP_KEY):

       $setup_key
EOF
  else
    cat <<EOF
  Your data and your .env files were kept. The setup key, if you still need it:
       grep ZETTA_SETUP_KEY "$server_env"
EOF
  fi
}

# ZETTA_INSTALL_SOURCE_ONLY=1 loads the functions without running anything (the tests do that).
[ -n "${ZETTA_INSTALL_SOURCE_ONLY:-}" ] || main "$@"
