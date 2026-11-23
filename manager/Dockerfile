# Stage 1: Build React/Vite Frontend
FROM node:22-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Build TypeScript Backend
FROM node:22-alpine AS server-builder
WORKDIR /build/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

# Stage 3: Production Runtime
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    GAME_FILES_MOUNT_PATH=/opt/valheim-shared

COPY server/package.json server/package-lock.json* ./server/
RUN cd /app/server && npm install --omit=dev

COPY --from=server-builder /build/server/dist ./server/dist
COPY --from=web-builder /build/web/dist ./public

RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "/app/server/dist/index.js"]
