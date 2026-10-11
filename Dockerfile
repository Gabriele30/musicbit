FROM node:24-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY experiments/playback/package.json experiments/playback/package.json
COPY experiments/youtube-playback/package.json experiments/youtube-playback/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS api-deps
# Prune dev dependencies in an isolated build stage; retain workspace symlinks.
RUN CI=true pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
WORKDIR /app
COPY --from=api-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=api-deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/scripts/create-accounts.mjs ./scripts/create-accounts.mjs
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV MUSICBIT_DB_PATH=/data/musicbit.sqlite
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]

FROM nginx:stable-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
