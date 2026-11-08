# One image runs all three API processes; the compose file picks the command:
#   node dist/index.js          public API
#   node dist/webhook/index.js  Paystack webhook service
#   node dist/worker/index.js   outbox + maintenance worker
#   node dist/db/migrate.js     one-off migrations
# Build from the repository root:  docker build -f api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
RUN npm ci --workspace @jetty/api
COPY tsconfig.base.json ./
COPY api api
RUN npm run build --workspace @jetty/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace @jetty/api && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY api/drizzle api/drizzle
WORKDIR /app/api
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
