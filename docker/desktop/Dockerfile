# Persistent Linux desktop ("VM") for Zetta computer use: one container per VM row (computer_vm), driven by cua-spacesd.
# Build: docker build -t zetta-desktop:latest docker/desktop
# Started by apps/server/src/modules/computer/vm.ts with: no capabilities, memory/cpu/pid limits, port 3211 published on
# 127.0.0.1 only, /home/agent on a named volume (zetta-vm-<id>) and the per-start bearer token mounted read-only.
# Smallest desktop that runs Chromium: Xvfb + Openbox (no full DE), D-Bus + AT-SPI for cua-driver's accessibility reads.
FROM debian:trixie-slim

ARG TARGETARCH
# cua-spacesd release (FSL-1.1-MIT, links the MIT cua-driver). The glibc build: the static one ships without the driver (no /mcp).
# Checksums from the release's SHA256SUMS.
ARG SPACESD_VERSION=0.8.0
ARG SPACESD_SHA256_AMD64=d0b43e96ab6a0fd0ee758195fa4aa1e228848c0472bef4950b028b37b44b168f
ARG SPACESD_SHA256_ARM64=09c8df972551088ac2b08b52ff3d86345e35a13f250681173af798d3f822b64d

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xvfb openbox chromium fonts-liberation fonts-dejavu-core \
      dbus dbus-x11 at-spi2-core libatk-adaptor libgail-common x11-utils xdotool xclip xdg-utils procps \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/agent --shell /bin/bash agent

RUN set -eu; case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) arch=x86_64; sum="$SPACESD_SHA256_AMD64" ;; arm64) arch=aarch64; sum="$SPACESD_SHA256_ARM64" ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/spacesd.tgz "https://github.com/trycua/cua/releases/download/cua-spacesd-v${SPACESD_VERSION}/cua-spacesd-linux-${arch}.tar.gz"; \
    echo "$sum  /tmp/spacesd.tgz" | sha256sum -c -; \
    mkdir /tmp/spacesd; tar -xzf /tmp/spacesd.tgz -C /tmp/spacesd; install -m 0755 /tmp/spacesd/cua-spacesd /usr/local/bin/cua-spacesd; \
    install -d /usr/share/doc/cua-spacesd; cp /tmp/spacesd/LICENSE /tmp/spacesd/THIRD_PARTY_NOTICES.md /usr/share/doc/cua-spacesd/; \
    rm -rf /tmp/spacesd.tgz /tmp/spacesd; cua-spacesd --version

# Chromium: no sign-in/sync/password manager prompts; the user signs in to sites, never to the browser itself.
RUN mkdir -p /etc/chromium/policies/managed \
 && printf '%s' '{"BrowserSignin":0,"SyncDisabled":true,"PasswordManagerEnabled":false,"PromotionsEnabled":false,"DefaultBrowserSettingEnabled":false,"MetricsReportingEnabled":false,"TranslateEnabled":false,"CommandLineFlagSecurityWarningsEnabled":false}' \
      > /etc/chromium/policies/managed/zetta.json
COPY entrypoint.sh /usr/local/bin/zetta-desktop
COPY autostart /etc/xdg/openbox/autostart
RUN chmod 0755 /usr/local/bin/zetta-desktop /etc/xdg/openbox/autostart

ENV HOME=/home/agent DISPLAY=:1 CUA_ENV_PORT=3211 CUA_ENV_ALLOW_ANONYMOUS=0
USER 10001:10001
EXPOSE 3211
ENTRYPOINT ["/usr/local/bin/zetta-desktop"]
