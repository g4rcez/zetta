#!/usr/bin/env bash
# Zetta installer: curl -fsSL https://zettabot.app/install | bash
# Clones the repository, writes the two .env files and starts the containers. The same steps as "Run it on your server" on the landing page.
# ZETTA_DIR chooses the install folder (default: $HOME/zetta). Run it again to update: it pulls the code and keeps your .env files.
# All code is inside main(), called on the last line, so a download that stops half way runs nothing.
set -euo pipefail

REPO_URL="https://github.com/g4rcez/zetta.git"

fail() {
  echo "error: $*" >&2
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

main() {
  case "$(uname -s)" in
  Darwin | Linux) ;;
  *) fail "this installer supports macOS, Linux and WSL. On Windows, run it inside WSL." ;;
  esac

  command -v git >/dev/null 2>&1 || fail "git is required"
  command -v openssl >/dev/null 2>&1 || fail "openssl is required"
  local container
  container=$(find_runtime) || fail "a running docker or podman is required"
  "$container" compose version >/dev/null 2>&1 || fail "$container compose is required"

  local dir="${ZETTA_DIR:-$HOME/zetta}"
  if [ ! -e "$dir" ]; then
    echo "▶ Cloning Zetta into $dir"
    git clone "$REPO_URL" "$dir"
  elif git -C "$dir" remote get-url origin 2>/dev/null | grep -q "g4rcez/zetta"; then
    echo "▶ Updating Zetta in $dir"
    git -C "$dir" pull --ff-only
  else
    fail "$dir exists and is not a Zetta clone. Set ZETTA_DIR to another folder."
  fi

  # Never overwrite an existing .env: the secrets in it protect data that is already stored.
  local server_env="$dir/apps/server/.env"
  local web_env="$dir/apps/web/.env"
  if [ ! -f "$server_env" ]; then
    echo "▶ Writing apps/server/.env"
    (
      umask 077
      cat >"$server_env" <<EOF
BETTER_AUTH_SECRET=$(secret)
ZETTA_SERVER_URL=http://localhost:3001
ZETTA_CONNECTION_KEY=$(secret)
ZETTA_SETUP_KEY=$(secret)
EOF
    )
  fi
  if [ ! -f "$web_env" ]; then
    echo "▶ Writing apps/web/.env"
    echo "ZETTA_SERVER_URL=http://localhost:3001" >"$web_env"
  fi

  echo "▶ Building and starting the containers"
  (cd "$dir" && "$container" compose up -d --build)

  cat <<EOF

Zetta is running.
  1. Open http://localhost:3001
  2. Paste the setup key. To read it:
       grep ZETTA_SETUP_KEY "$server_env"
EOF
}

main "$@"
