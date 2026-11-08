# Storefront and admin (Next.js standalone output). Build from the repository root:
#   docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=... .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY frontend/package.json frontend/
RUN npm ci --workspace @jetty/frontend
COPY tsconfig.base.json ./
COPY frontend frontend
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so changing them means rebuilding.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_HOST
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_MEDIA_HOST=$NEXT_PUBLIC_MEDIA_HOST \
    BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
# The build fetches pages from the API only if it is reachable; API_BASE_URL is supplied at run time.
RUN npm run build --workspace @jetty/frontend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static frontend/.next/static
COPY --from=build /app/frontend/public frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
