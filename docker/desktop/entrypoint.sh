#!/bin/sh
# TigerVNC X server (VNC on 5900) -> session D-Bus (+ AT-SPI) -> XFCE (autostarts Chromium) -> cua-spacesd in the foreground.
# The bearer token and the VNC password are files the server mounts read-only; neither service starts without its secret.
set -eu
TOKEN_FILE="${ZETTA_TOKEN_FILE:-/run/zetta/token}"
VNC_FILE="${ZETTA_VNC_FILE:-/run/zetta/vncpass}"
[ -r "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE; refusing to start" >&2; exit 1; }
[ -r "$VNC_FILE" ] || { echo "no VNC password at $VNC_FILE; refusing to start" >&2; exit 1; }

# A stopped VM is restarted with `docker start`, which keeps /tmp: clear the previous boot's X server lock and sockets.
rm -rf /tmp/.X*-lock /tmp/.X11-unix /tmp/runtime-agent /tmp/vncpasswd
mkdir -p "$HOME/.config" /tmp/runtime-agent && chmod 700 /tmp/runtime-agent
export XDG_RUNTIME_DIR=/tmp/runtime-agent NO_AT_BRIDGE=0 GTK_MODULES=gail:atk-bridge
export XDG_CURRENT_DESKTOP=XFCE XDG_SESSION_DESKTOP=xfce XDG_SESSION_TYPE=x11

# TigerVNC reads an obfuscated password file; the plain one is mounted read-only, so convert it into /tmp (0600).
(umask 077; vncpasswd -f < "$VNC_FILE" > /tmp/vncpasswd)
Xtigervnc "$DISPLAY" -geometry "${ZETTA_SCREEN:-1280x800}" -depth 24 -rfbport 5900 -localhost=0 -SecurityTypes VncAuth -PasswordFile /tmp/vncpasswd \
  -AlwaysShared -AcceptSetDesktopSize=0 -desktop "Zetta computer" -nolisten tcp >/tmp/xvnc.log 2>&1 &
i=0; until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 100 ] && { echo "Xtigervnc did not start" >&2; exit 1; }; sleep 0.1; done
xset s off; xset s noblank; xset -dpms 2>/dev/null || true

eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS
/usr/libexec/at-spi-bus-launcher --launch-immediately >/tmp/atspi.log 2>&1 &

startxfce4 >/tmp/xfce.log 2>&1 &

export CUA_ENV_TOKEN_FILE="$TOKEN_FILE"
exec cua-spacesd
