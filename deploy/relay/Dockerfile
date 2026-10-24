FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages ./packages
COPY services ./services
COPY apps/cli ./apps/cli
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile && pnpm exec tsc -p tsconfig.build.json

FROM node:24-bookworm-slim
ENV NODE_ENV=production SHOT2AGENT_HOST=0.0.0.0 SHOT2AGENT_DEVICE_FILE=/run/shot2agent/devices.json SHOT2AGENT_RELAY_ROOT=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY scripts/relay-devices.mjs ./relay-devices.mjs
RUN mkdir /data && chown node:node /data
USER node
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/services/relay/src/main.js"]
