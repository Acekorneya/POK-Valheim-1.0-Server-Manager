#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  POK-Valheim Linux Docker Setup"
echo "=========================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 plugin is required ('docker compose')."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  # Generate a random JWT secret automatically
  RAND_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 40)
  sed -i "s|POK_JWT_SECRET=.*|POK_JWT_SECRET=${RAND_SECRET}|" .env
  echo "[+] Created .env from .env.example (with generated JWT secret)."
  echo "    Tip: Edit .env to set POK_ADMIN_PASS and PUBLIC_HOST."
fi

mkdir -p ./data

echo "[+] Building POK-Valheim Linux Dedicated Server image (with SteamCMD)..."
docker compose --profile build-only build pok-valheim-server-image

echo "[+] Building and starting POK-Valheim Web Manager..."
docker compose up -d --build pok-valheim-manager

WEB_PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || echo "8080")
WEB_PORT="${WEB_PORT:-8080}"

echo ""
echo "=========================================="
echo "  POK-Valheim is LIVE!"
echo "  Web UI: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${WEB_PORT}"
echo "  Default Login: admin / pokvalheim (change in .env)"
echo "=========================================="
