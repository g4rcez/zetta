FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/server && bun run build

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
COPY --from=builder /app /app

EXPOSE 3000

WORKDIR /app/apps/server
CMD ["bun", "dist/index.mjs"]
