# Throwaway browser for Zetta computer use (one container per user+profile session), driven by agent-browser.
# Build: docker build -t zetta-browser:latest docker/browser
# Started by apps/server/src/modules/computer/service.ts with: no capabilities, read-only root, memory/cpu/pid limits, no network
# (`--network none`), only this profile's directory mounted, and the server's egress socket mounted read-only at /run/zetta/egress.
# The server runs `docker exec ... agent-browser` in it; Chromium reaches the internet only through the egress proxy, which refuses
# private and loopback addresses.
FROM node:22-slim

# agent-browser 0.41.0 (Apache-2.0). The tarball is checked against the sha512 the registry published for this version before it is installed.
ARG AGENT_BROWSER_VERSION=0.41.0
ARG AGENT_BROWSER_INTEGRITY=sha512-XJtBouE5+gGUKyZU1COSmnxU6MKIlmLE2oEyHzl0ohLVOhuRjx9kqQ9vOqxiiW/Gbvi4JPF4Oz777Mn3FGiHAA==

RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation socat && rm -rf /var/lib/apt/lists/* \
 && cd /tmp && npm pack "agent-browser@${AGENT_BROWSER_VERSION}" --silent \
 && node -e 'const c=require("crypto"),f="/tmp/agent-browser-"+process.argv[1]+".tgz",h="sha512-"+c.createHash("sha512").update(require("fs").readFileSync(f)).digest("base64");if(h!==process.argv[2]){console.error("agent-browser integrity mismatch: "+h);process.exit(1)}' "${AGENT_BROWSER_VERSION}" "${AGENT_BROWSER_INTEGRITY}" \
 && npm install -g --no-audit --no-fund "/tmp/agent-browser-${AGENT_BROWSER_VERSION}.tgz" \
 && rm -f /tmp/agent-browser-*.tgz \
 && agent-browser --version \
 && mkdir -p /etc/zetta && echo '{}' > /etc/zetta/agent-browser.json \
 && useradd --uid 10001 --create-home --home-dir /home/agent agent
ENV HOME=/home/agent
USER 10001:10001
ENTRYPOINT []
# Chromium's proxy setting is http://127.0.0.1:3128; socat carries it to the server's unix socket. Started with `docker run --init`.
CMD ["socat", "TCP-LISTEN:3128,bind=127.0.0.1,fork,reuseaddr", "UNIX-CONNECT:/run/zetta/egress/proxy.sock"]
