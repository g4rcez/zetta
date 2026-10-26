#!/bin/sh
# Xvfb -> session D-Bus (+ AT-SPI) -> Openbox (autostarts Chromium) -> cua-spacesd in the foreground.
# The bearer token is read from a file the server mounts read-only; spacesd refuses to start without one.
set -eu
TOKEN_FILE="${ZETTA_TOKEN_FILE:-/run/zetta/token}"
[ -r "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE; refusing to start" >&2; exit 1; }

# A stopped VM is restarted with `docker start`, which keeps /tmp: clear the previous boot's X server lock and sockets.
rm -rf /tmp/.X*-lock /tmp/.X11-unix /tmp/runtime-agent
mkdir -p "$HOME/.config" /tmp/runtime-agent && chmod 700 /tmp/runtime-agent
export XDG_RUNTIME_DIR=/tmp/runtime-agent NO_AT_BRIDGE=0 GTK_MODULES=gail:atk-bridge

Xvfb "$DISPLAY" -screen 0 "${ZETTA_SCREEN:-1280x800x24}" -nolisten tcp >/tmp/xvfb.log 2>&1 &
i=0; until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 100 ] && { echo "Xvfb did not start" >&2; exit 1; }; sleep 0.1; done

eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS
/usr/libexec/at-spi-bus-launcher --launch-immediately >/tmp/atspi.log 2>&1 &

openbox-session >/tmp/openbox.log 2>&1 &

export CUA_ENV_TOKEN_FILE="$TOKEN_FILE"
exec cua-spacesd
