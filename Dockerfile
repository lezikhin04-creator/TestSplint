# syntax=docker/dockerfile:1
# Pin the verified image digest in the release process. No credentials are build arguments.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    ALLOW_DEV_AUTH=false \
    MEDIA_STORAGE=r2 \
    STATIC_DIR=/app/apps/miniapp/dist
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/miniapp/package.json ./apps/miniapp/package.json
COPY --from=build /app/apps/miniapp/dist ./apps/miniapp/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
# Migrations, catalog seeding and webhook registration are explicit operator actions.
CMD ["node", "apps/api/dist/server.js"]
