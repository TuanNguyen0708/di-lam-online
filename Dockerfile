FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/game-api/package.json apps/game-api/package.json
COPY apps/game-web/package.json apps/game-web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3101
EXPOSE 3101
CMD ["node", "apps/game-api/dist/main.js"]
