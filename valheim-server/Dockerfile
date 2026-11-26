# Stage 1: Build POK-Valheim-Bridge (100% Server-Side RCON BepInEx Plugin)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS bridge-builder
WORKDIR /src
COPY pok-bridge/POKValheimBridge.csproj ./
RUN dotnet restore
COPY pok-bridge/ ./
RUN dotnet build -c Release -o /out --no-restore

# Stage 2: POK-Valheim Dedicated Linux Server Image
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    STEAMCMD_DIR=/opt/steamcmd \
    VALHEIM_DIR=/opt/valheim \
    CONFIG_DIR=/config \
    SERVER_NAME="POK-Valheim Server" \
    WORLD_NAME="Midgard" \
    SERVER_PASS="secret123" \
    SERVER_PORT=2456 \
    SERVER_PUBLIC=0 \
    CROSSPLAY=false \
    SAVE_INTERVAL=1800 \
    BACKUPS=4 \
    BACKUPSHORT=7200 \
    BACKUPLONG=43200 \
    UPDATE_ON_START=true \
    UPDATE_ONLY=false \
    PRESET="" \
    MODIFIER_COMBAT="" \
    MODIFIER_DEATHPENALTY="" \
    MODIFIER_RESOURCES="" \
    MODIFIER_RAIDS="" \
    MODIFIER_PORTALS="" \
    KEY_NOBUILDCOST=false \
    KEY_PLAYEREVENTS=false \
    KEY_PASSIVEMOBS=false \
    KEY_NOMAP=false \
    KEY_FIRE=false \
    KEY_DUNGEONBUILD=false \
    MODS_ENABLED=false \
    POK_RCON_ENABLED=false \
    POK_RCON_PORT=2458 \
    POK_RCON_PASSWORD="" \
    EXTRA_ARGS="" \
    TZ=UTC

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      lib32gcc-s1 \
      lib32stdc++6 \
      libatomic1 \
      libpulse0 \
      libpulse-dev \
      procps \
      tzdata \
      util-linux \
      tar \
      gzip && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p "${STEAMCMD_DIR}" "${VALHEIM_DIR}" "${CONFIG_DIR}/worlds_local" /opt/pok-bridge && \
    curl -fsSL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar -xz -C "${STEAMCMD_DIR}" && \
    "${STEAMCMD_DIR}/steamcmd.sh" +quit || true

COPY --from=bridge-builder /out/POKValheimBridge.dll /opt/pok-bridge/POKValheimBridge.dll
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /opt/valheim

EXPOSE 2456-2457/udp

STOPSIGNAL SIGINT

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
