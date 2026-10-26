# Throwaway browser for Zetta computer use (one container per user+profile session).
# Build: docker build -t zetta-browser:latest docker/browser
# Started by apps/server/src/modules/computer/service.ts with: no capabilities, read-only root, memory/cpu/pid limits,
# a CDP port published on 127.0.0.1 only, and only this profile's directory mounted.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation socat && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/agent agent
ENV HOME=/home/agent
USER 10001:10001
ENTRYPOINT []
# Chromium's DevTools endpoint only listens on 127.0.0.1 inside the container; socat exposes it on the container's interface so Docker can publish it (to the host's loopback only).
CMD ["sh", "-c", "socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223 & exec chromium --headless=new --disable-breakpad --crash-dumps-dir=/tmp --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9223 --user-data-dir=/profile --window-size=1024,640 about:blank"]
