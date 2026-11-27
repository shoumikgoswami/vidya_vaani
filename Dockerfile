# Vidya Vaani: one container, so it starts the same way everywhere.
FROM node:22-slim AS deps
WORKDIR /app
# Build tools are only a fallback for when better-sqlite3 has no prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /data && chown -R node:node /data
ENV NODE_ENV=production DATA_DIR=/data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
