# Persistent Linux desktop ("VM") for Zetta computer use: one container per VM row (computer_vm), driven by cua-spacesd.
# Build: docker build -t zetta-desktop:latest docker/desktop
# Started by apps/server/src/modules/computer/vm.ts with no capabilities, no-new-privileges, memory/cpu/pid limits, ports 3211
# (spacesd), 5900 (VNC) and 9222 (Chromium DevTools, no auth: any local process can drive this browser) published on 127.0.0.1 only, /home/agent on a named volume (zetta-vm-<id>) and the per-start bearer token
# and VNC password mounted read-only.
# Desktop: TigerVNC's X server (the screen people see over VNC is the one bots drive) + XFCE (panel, menu, terminal, file manager),
# D-Bus + AT-SPI for cua-driver's accessibility reads. There is no root: software is installed per user under /home/agent (e.g.
# `dpkg-deb -x some.deb ~/.local/opt/name`), which lives on the volume and so survives stops and image updates.
# Debian is the default. The Ubuntu machine is the same image on another base without a browser (Ubuntu ships Chromium only as a snap, which
# does not run in a container):
#   docker build -t zetta-desktop-ubuntu:latest --build-arg BASE_IMAGE=ubuntu:24.04 --build-arg BROWSER=none docker/desktop
ARG BASE_IMAGE=debian:trixie-slim
FROM ${BASE_IMAGE}

ARG TARGETARCH
ARG BROWSER=chromium
# cua-spacesd release (FSL-1.1-MIT, links the MIT cua-driver). The glibc build: the static one ships without the driver (no /mcp).
# Checksums from the release's SHA256SUMS.
ARG SPACESD_VERSION=0.8.0
ARG SPACESD_SHA256_AMD64=d0b43e96ab6a0fd0ee758195fa4aa1e228848c0472bef4950b028b37b44b168f
ARG SPACESD_SHA256_ARM64=09c8df972551088ac2b08b52ff3d86345e35a13f250681173af798d3f822b64d

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget procps less nano socat $([ "$BROWSER" = chromium ] && echo chromium) fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
      tigervnc-standalone-server tigervnc-tools x11-utils x11-xserver-utils x11-xkb-utils xdotool xclip xdg-utils \
      xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings xfce4-terminal xfce4-appfinder thunar adwaita-icon-theme \
      dbus dbus-x11 at-spi2-core libatk-adaptor libgail-common \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/agent --shell /bin/bash agent \
 # XFCE asks how to set up the panel on first login: start from its default panel instead.
 && cp /etc/xdg/xfce4/panel/default.xml /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml

RUN set -eu; case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) arch=x86_64; sum="$SPACESD_SHA256_AMD64" ;; arm64) arch=aarch64; sum="$SPACESD_SHA256_ARM64" ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/spacesd.tgz "https://github.com/trycua/cua/releases/download/cua-spacesd-v${SPACESD_VERSION}/cua-spacesd-linux-${arch}.tar.gz"; \
    echo "$sum  /tmp/spacesd.tgz" | sha256sum -c -; \
    mkdir /tmp/spacesd; tar -xzf /tmp/spacesd.tgz -C /tmp/spacesd; install -m 0755 /tmp/spacesd/cua-spacesd /usr/local/bin/cua-spacesd; \
    install -d /usr/share/doc/cua-spacesd; cp /tmp/spacesd/LICENSE /tmp/spacesd/THIRD_PARTY_NOTICES.md /usr/share/doc/cua-spacesd/; \
    rm -rf /tmp/spacesd.tgz /tmp/spacesd; cua-spacesd --version

# agent-desktop release (Apache-2.0): the CLI that the VM's agent-desktop driver runs with `docker exec`. Released builds have no `mcp`
# command yet (it is on main only), so the driver reads each command's JSON envelope. The clipboard helper must sit beside the binary.
# Checksums from the release's checksums.txt.
ARG AGENT_DESKTOP_VERSION=1.1.0
ARG AGENT_DESKTOP_SHA256_AMD64=efbdcf4caf10132e4fe915db1ec643184c947c65e0511845aeb4839445d7ea43
ARG AGENT_DESKTOP_SHA256_ARM64=252c17e271a444352a5ba1e9f8fcbace89fa7b6b0bfcc4abebad2b35eb1f7a4d
RUN set -eu; case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) arch=x86_64; sum="$AGENT_DESKTOP_SHA256_AMD64" ;; arm64) arch=aarch64; sum="$AGENT_DESKTOP_SHA256_ARM64" ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/ad.tgz "https://github.com/vercel-labs/agent-desktop/releases/download/v${AGENT_DESKTOP_VERSION}/agent-desktop-v${AGENT_DESKTOP_VERSION}-${arch}-unknown-linux-gnu.tar.gz"; \
    echo "$sum  /tmp/ad.tgz" | sha256sum -c -; \
    mkdir /tmp/ad; tar -xzf /tmp/ad.tgz -C /tmp/ad; install -m 0755 /tmp/ad/agent-desktop /tmp/ad/agent-desktop-linux-clipboard-owner /usr/local/bin/; \
    install -d /usr/share/doc/agent-desktop; curl -fsSL -o /usr/share/doc/agent-desktop/LICENSE "https://raw.githubusercontent.com/vercel-labs/agent-desktop/v${AGENT_DESKTOP_VERSION}/LICENSE"; \
    rm -rf /tmp/ad.tgz /tmp/ad; agent-desktop version

# Chromium: no sign-in/sync/password manager prompts; the user signs in to sites, never to the browser itself.
RUN [ "$BROWSER" = chromium ] || exit 0; mkdir -p /etc/chromium/policies/managed \
 && printf '%s' '{"BrowserSignin":0,"SyncDisabled":true,"PasswordManagerEnabled":false,"PromotionsEnabled":false,"DefaultBrowserSettingEnabled":false,"MetricsReportingEnabled":false,"TranslateEnabled":false,"CommandLineFlagSecurityWarningsEnabled":false}' \
      > /etc/chromium/policies/managed/zetta.json
COPY entrypoint.sh /usr/local/bin/zetta-desktop
COPY chromium-loop /usr/local/bin/zetta-chromium
COPY zetta-chromium.desktop /etc/xdg/autostart/zetta-chromium.desktop
COPY zetta-agent-desktop /usr/local/bin/zetta-agent-desktop
# No compositing: agent-desktop cannot capture the whole screen under a compositing window manager (it refuses; per-window capture works).
COPY xfwm4.xml /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml
RUN chmod 0755 /usr/local/bin/zetta-desktop /usr/local/bin/zetta-chromium /usr/local/bin/zetta-agent-desktop \
 && { [ "$BROWSER" = chromium ] || rm -f /etc/xdg/autostart/zetta-chromium.desktop; }

ENV HOME=/home/agent DISPLAY=:1 CUA_ENV_PORT=3211 CUA_ENV_ALLOW_ANONYMOUS=0
USER 10001:10001
EXPOSE 3211 5900
ENTRYPOINT ["/usr/local/bin/zetta-desktop"]
