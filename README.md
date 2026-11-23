# POK-Valheim — Multi-Realm Linux Docker Server Manager

**POK-Valheim** is a complete, Docker-powered Valheim Dedicated Server stack for Linux with a modern Web UI designed for groups who run multiple realms side-by-side (e.g., Main World, Resource Farm, Creative Builder) and jump back and forth between servers/saves.

## Features

- **Multi-Server Docker Orchestration**: Spin up, start, stop (graceful `SIGINT` world save), restart, and monitor multiple Valheim Linux server containers from one dashboard.
- **Shared SteamCMD Game Cache**: All server containers share a single `pok-valheim-gamefiles` Docker volume with `flock` locking — running 3+ realms only downloads Valheim once.
- **Quick Realm Presets & Full World Modifiers**: One-click templates (`Main Realm`, `Resource Farm 3x + Ore Portals`, `Creative Builder`, `Hardcore`) plus full control over Combat, Resources, Portals, Raids, Death Penalty, Crossplay (PlayFab), and custom flags.
- **Worlds & Saves Vault (Jump & Transfer Hub)**:
  - Upload local `.db` / `.fwl` / `.zip` saves directly from the browser.
  - Copy/clone worlds between servers or the central **World Vault**.
  - Hot-swap a server's active world in one click.
  - Edit `adminlist.txt`, `bannedlist.txt`, and `permittedlist.txt` live.
- **Automated & On-Demand Backups**:
  - Cron-scheduled `.tar.gz` backups with configurable retention count.
  - Instant manual snapshots with notes.
  - One-click **Safe Restore** (gracefully stops server, takes a pre-restore safety snapshot, restores archive, and restarts).
- **Auto-Updates (Steam Build Tracking)**:
  - Monitors Steam AppID `896660` for new Valheim builds.
  - Optional automatic update workflow: gracefully saves & stops running servers → backs up → runs SteamCMD update → restarts servers.
- **Live Console & Metrics**: Real-time WebSocket container logs, PlayFab Join Code detection, CPU/RAM stats, uptime, and one-click copy for server address & password.

---

## Quick Start on Linux

### Prerequisites
- Linux host with **Docker** and **Docker Compose v2** (`docker compose`)
- Open UDP firewall ports for each realm you create (e.g., `2456-2457/udp` for Realm 1, `2458-2459/udp` for Realm 2, etc.)

### 1. Run the setup script
```bash
chmod +x scripts/setup-linux.sh
./scripts/setup-linux.sh
```

Or run manually with Docker Compose:
```bash
cp .env.example .env
# Edit .env to set your admin password and PUBLIC_HOST
docker compose --profile build-only build pok-valheim-server-image
docker compose up -d --build pok-valheim-manager
```

### 2. Open the Web UI
Navigate to:
```
http://<your-linux-ip>:8080
```
Default login (change in `.env`):
- **Username**: `admin`
- **Password**: `pokvalheim`

---

## Project Structure

```
Valheim_Pok_server/
├── docker-compose.yml          # Manager + Valheim server image build definition
├── .env.example                # Environment configuration template
├── scripts/
│   └── setup-linux.sh          # One-command Linux build & launch script
├── valheim-server/
│   ├── Dockerfile              # Debian slim + SteamCMD + Valheim Linux dependencies
│   └── entrypoint.sh           # flock-safe SteamCMD update, modifiers, SIGINT graceful save
└── manager/
    ├── Dockerfile              # Multi-stage build (React frontend + Node/TS API)
    ├── server/                 # Express + TypeScript + Dockerode + WebSockets + Cron
    └── web/                    # React 19 + Vite + Tailwind CSS v4 + Lucide Icons
```

## Ports Reference

| Service | Port | Protocol |
|---|---|---|
| POK-Valheim Web UI | `8080` (configurable via `WEB_PORT`) | TCP |
| Realm 1 (default) | `2456-2457` | UDP |
| Realm 2 (auto-assigned) | `2458-2459` | UDP |
| Realm N | `2456 + 2*(N-1)` and `+1` | UDP |
