FROM node:22-slim AS deps

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api-node ./apps/api-node

RUN pnpm install --frozen-lockfile --filter @ignislink/api-node...
RUN pnpm --filter @ignislink/api-node build

EXPOSE 3001

CMD ["pnpm", "--filter", "@ignislink/api-node", "start"]
