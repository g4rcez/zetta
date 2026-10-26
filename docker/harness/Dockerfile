# Throwaway harness image: one turn of one CLI per container (see apps/server/src/modules/chat/harness.ts).
# Build:  docker build -t zetta-harness:latest docker/harness
# Only Claude Code is installed by default; add other CLIs with their official install steps if you want them in containers.
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code@latest && npm cache clean --force \
 && useradd --uid 10001 --create-home --home-dir /home/agent agent || true
USER 10001:10001
WORKDIR /work
ENV HOME=/home/agent
# The node base image would run unknown commands as scripts; run exactly the command we pass.
ENTRYPOINT []
