FROM node:22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache python3 make g++

ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_PROGRESS=false
ENV NPM_CONFIG_LOGLEVEL=warn

COPY packages/server/package*.json ./packages/server/
RUN cd packages/server && npm install --no-audit --no-fund --prefer-offline --legacy-peer-deps

COPY client-vue/package*.json ./client-vue/
RUN cd client-vue && npm install --no-audit --no-fund --prefer-offline --legacy-peer-deps

COPY . .

RUN cd packages/server && npm run build
RUN cd client-vue && npm run build

FROM node:22-alpine AS production

WORKDIR /app
RUN apk add --no-cache su-exec

COPY --from=builder /app/packages/server/package*.json ./packages/server/
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/client-vue/dist ./client-vue/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/uploads /app/logs /app/data

EXPOSE 3003

ENV NODE_ENV=production
ENV PORT=3003
ENV STORAGE_PATH=/app/uploads
ENV DATABASE_URL=/app/data/cloudimgs.db
ENV PUID=1000
ENV PGID=1000
ENV UMASK=002

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/server/dist/index.js"]
