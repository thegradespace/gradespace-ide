# syntax=docker/dockerfile:1
# Build from the repository root, because the relay imports workspace packages:
#   docker build --file infra/relay/Dockerfile --tag gradespace-connect-relay .
# docker-compose.yml in this folder does that for you.

FROM node:26.13.1-bookworm-slim AS install
WORKDIR /repo
RUN npm install --global pnpm@12.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches ./patches
COPY packages ./packages
COPY infra/relay ./infra/relay
# No install scripts: the root `prepare` needs dev tooling, and nothing the relay runs has a native build.
RUN pnpm install --filter "t3code-relay..." --prod --frozen-lockfile --ignore-scripts

FROM node:26.13.1-bookworm-slim
ENV NODE_ENV=production \
    RELAY_HOST=0.0.0.0 \
    RELAY_PORT=8787
COPY --from=install --chown=node:node /repo /repo
WORKDIR /repo/infra/relay
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.RELAY_PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node runs the TypeScript sources directly; migrations in migrations/postgres apply on boot.
CMD ["node", "src/node/main.ts"]
