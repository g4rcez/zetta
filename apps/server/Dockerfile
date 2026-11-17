FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/server && bun run build

# The agent CLIs bots run on (Claude Code, Codex) are NOT in the image by default: each is a native binary of 300 to 430 MB, a person usually
# uses one of them, and the server does not use the copy they already have on their computer. ZETTA_AGENTS puts the ones you list in
# the image: "claude-code", "codex", both ("claude-code codex") or empty / "none" for neither (the engines then read "Not installed" in Studio).
# install.sh --agents sets it. They are Node programs and the runtime image below has no Node, so they are installed here and copied in with the
# node binary, and only when at least one is asked for. Versions are pinned; Claude Code matches docker/harness/Dockerfile.
FROM node:22-slim AS agents
ARG ZETTA_AGENTS=""
ARG CLAUDE_CODE_VERSION=2.1.312
ARG CODEX_VERSION=0.163.0
RUN set -eu; packages=""; \
    for agent in $ZETTA_AGENTS; do \
      case "$agent" in \
        claude-code) packages="$packages @anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" ;; \
        codex) packages="$packages @openai/codex@$CODEX_VERSION" ;; \
        none) ;; \
        *) echo "unknown agent: $agent (use claude-code, codex or none)" >&2; exit 1 ;; \
      esac; \
    done; \
    mkdir -p /out/bin; \
    if [ -n "$packages" ]; then \
      npm install -g --prefix /out $packages; \
      cp /usr/local/bin/node /out/bin/node; \
      npm cache clean --force; \
    fi

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Password-manager CLIs for the 1Password and Bitwarden plugins (apps/server/src/modules/integrations/plugins/vault). Build with
# --build-arg VAULT_CLIS=0 to leave them out; those plugins then report "not installed on the server".
# op comes from 1Password's signed apt repository; bw and bws are pinned release zips checked against their published SHA-256 digests.
ARG VAULT_CLIS=1
ARG TARGETARCH
ARG BW_VERSION=2026.9.1
ARG BW_SHA256_AMD64=b90c0fc86bcf11c0b194aa3f0a89344738af0512cb267c39ad3250c5edd71663
ARG BW_SHA256_ARM64=6c2765f91d5bbba9864195c9a304a683bcc0bfa39cfd85ce9423142631e111a6
ARG BWS_VERSION=2.1.0
ARG BWS_SHA256_AMD64=ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860
ARG BWS_SHA256_ARM64=18253757286e119d450133a87eb463bf8c1ce418ce24c834f4f250d60cba6f9e
RUN set -eu; [ "$VAULT_CLIS" = "1" ] || exit 0; \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    curl -fsSL https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor -o /usr/share/keyrings/1password-archive-keyring.gpg; \
    echo "deb [arch=$arch signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$arch stable main" > /etc/apt/sources.list.d/1password.list; \
    apt-get update && apt-get install -y --no-install-recommends 1password-cli; \
    case "$arch" in \
      amd64) bw="bw-oss-linux-$BW_VERSION.zip"; bwsum="$BW_SHA256_AMD64"; bws="bws-x86_64-unknown-linux-gnu-$BWS_VERSION.zip"; bwssum="$BWS_SHA256_AMD64" ;; \
      arm64) bw="bw-oss-linux-arm64-$BW_VERSION.zip"; bwsum="$BW_SHA256_ARM64"; bws="bws-aarch64-unknown-linux-gnu-$BWS_VERSION.zip"; bwssum="$BWS_SHA256_ARM64" ;; \
      *) echo "unsupported arch $arch" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/bw.zip "https://github.com/bitwarden/clients/releases/download/cli-v$BW_VERSION/$bw"; echo "$bwsum  /tmp/bw.zip" | sha256sum -c -; \
    curl -fsSL -o /tmp/bws.zip "https://github.com/bitwarden/sdk-sm/releases/download/bws-v$BWS_VERSION/$bws"; echo "$bwssum  /tmp/bws.zip" | sha256sum -c -; \
    unzip -o /tmp/bw.zip -d /usr/local/bin bw; unzip -o /tmp/bws.zip -d /usr/local/bin bws; chmod 0755 /usr/local/bin/bw /usr/local/bin/bws; \
    rm -f /tmp/bw.zip /tmp/bws.zip; apt-get purge -y gnupg unzip; apt-get autoremove -y; rm -rf /var/lib/apt/lists/*; \
    op --version; bw --version; bws --version
# ssh, ssh-agent, sftp and curl: Zetta runs a bot's machine calls (SSH, SFTP, FTP) itself with the key or password the user saved, so the
# secret never reaches the bot (apps/server/src/modules/computer/machine-runner.ts). No daemon runs; they start for one call.
# ffmpeg turns the voice notes people send through Telegram or WhatsApp (OGG/Opus) into samples the speech model reads (modules/transcribe).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl openssh-client ffmpeg && rm -rf /var/lib/apt/lists/*
# The agent CLIs from the stage above (none by default) and the node binary they run on. Their sign-ins are kept in HOME, which
# docker-compose.yml puts on a volume.
COPY --from=agents /out /opt/agents
ENV PATH="/opt/agents/bin:${PATH}"
COPY --from=builder /app /app

# The commit this image was built from and its date (ISO 8601). The image holds no .git, so the server reads them from here
# (modules/updates/build-info.ts). install.sh sets both; an empty value means "Version unknown". After the heavy layers on purpose.
ARG ZETTA_BUILD_COMMIT=
ARG ZETTA_BUILD_DATE=
ENV ZETTA_BUILD_COMMIT=$ZETTA_BUILD_COMMIT \
    ZETTA_BUILD_DATE=$ZETTA_BUILD_DATE

EXPOSE 3000

WORKDIR /app/apps/server
# HOME is on a volume in docker-compose.yml and starts empty: make sure it exists before the server (and the agent CLIs) write into it.
CMD ["sh", "-c", "mkdir -p \"${HOME:-/root}\" && exec bun dist/index.mjs"]
