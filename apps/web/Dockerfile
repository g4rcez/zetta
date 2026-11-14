FROM node:24 AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install

ARG ZETTA_SERVER_URL
ENV ZETTA_SERVER_URL=${ZETTA_SERVER_URL}
ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/web && bun run build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# The nginx image fills the template with the environment at start and writes /etc/nginx/conf.d/default.conf.
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV ZETTA_API_UPSTREAM=server:3000
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
