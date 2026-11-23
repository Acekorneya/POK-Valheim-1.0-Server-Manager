#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  POK-Valheim Linux Docker Setup"
echo "=========================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed."
  echo "Install Docker on Ubuntu/Debian with:"
  echo "  curl -fsSL https://get.docker.com | sh"
  echo "  sudo usermod -aG docker \$USER"
  echo "Then log out and back in, and re-run ./scripts/setup-linux.sh"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 plugin is required ('docker compose')."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to the Docker daemon."
  echo "Make sure Docker is running and your user is in the docker group:"
  echo "  sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env

  # Generate a secure random JWT secret automatically
  RAND_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 40)
  sed -i "s|^POK_JWT_SECRET=.*|POK_JWT_SECRET=${RAND_SECRET}|" .env

  # Pick a free Web UI port automatically if 8080 is already taken
  CHOSEN_PORT=8080
  if command -v ss >/dev/null 2>&1; then
    for p in 8080 8088 8090 8180 8880 9080; do
      if ! ss -tln 2>/dev/null | grep -q ":${p} "; then
        CHOSEN_PORT="${p}"
        break
      fi
    done
  fi
  sed -i "s|^WEB_PORT=.*|WEB_PORT=${CHOSEN_PORT}|" .env

  # Detect LAN IP for one-click Copy Connect buttons
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  if [[ -n "${LAN_IP}" ]]; then
    sed -i "s|^PUBLIC_HOST=.*|PUBLIC_HOST=${LAN_IP}|" .env
  fi

  echo "[+] Created .env (Web UI port: ${CHOSEN_PORT}, Host: ${LAN_IP:-auto})"
  echo "    Tip: Edit .env anytime to change POK_ADMIN_PASS or PUBLIC_HOST."
fi

mkdir -p ./data

echo "[+] Building POK-Valheim Linux Dedicated Server image (with SteamCMD)..."
docker compose --profile build-only build pok-valheim-server-image

echo "[+] Building and starting POK-Valheim Web Manager..."
docker compose up -d --build pok-valheim-manager

WEB_PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || echo "8080")
WEB_PORT="${WEB_PORT:-8080}"
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "=========================================="
echo "  POK-Valheim is LIVE!"
echo "  Web UI:        http://${HOST_IP}:${WEB_PORT}"
echo "  Default Login: admin / pokvalheim"
echo "  (Change your password in .env and run: docker compose up -d pok-valheim-manager)"
echo "=========================================="
