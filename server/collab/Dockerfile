FROM node:20-alpine

WORKDIR /app

# Install deps first so they cache between builds when only source changes
COPY package*.json ./
RUN npm ci --omit=dev

# Source
COPY server.js ./
COPY lib ./lib

# Snapshots dir for the FileStore fallback (Postgres preferred in prod)
RUN mkdir -p /app/snapshots

ENV NODE_ENV=production
ENV PORT=1234
EXPOSE 1234

# Healthcheck — App Runner uses a TCP probe by default but we expose HTTP too
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:1234/healthz || exit 1

CMD ["node", "server.js"]
