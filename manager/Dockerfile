# Stage 1: Build POK-Valheim-QoL Client/Server Mod (BepInEx)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS qol-builder
WORKDIR /build/qol
COPY pok-qol/POKValheimQoL.csproj ./
RUN dotnet restore
COPY pok-qol/ ./
RUN dotnet build -c Release -o /out --no-restore

# Stage 2: Build React/Vite Frontend
FROM node:22-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 3: Build TypeScript Backend
FROM node:22-alpine AS server-builder
WORKDIR /build/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

# Stage 4: Production Runtime
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    GAME_FILES_MOUNT_PATH=/opt/valheim-shared \
    POK_QOL_DLL_PATH=/app/pok-qol/POKValheimQoL.dll

COPY server/package.json server/package-lock.json* ./server/
RUN cd /app/server && npm install --omit=dev

COPY --from=server-builder /build/server/dist ./server/dist
COPY --from=web-builder /build/web/dist ./public
COPY --from=qol-builder /out/POKValheimQoL.dll ./pok-qol/POKValheimQoL.dll

RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "/app/server/dist/index.js"]
