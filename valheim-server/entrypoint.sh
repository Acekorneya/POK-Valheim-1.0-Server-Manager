#!/usr/bin/env bash
set -euo pipefail

STEAMCMD_DIR="${STEAMCMD_DIR:-/opt/steamcmd}"
VALHEIM_DIR="${VALHEIM_DIR:-/opt/valheim}"
CONFIG_DIR="${CONFIG_DIR:-/config}"
LOCK_FILE="${VALHEIM_DIR}/.pok_update.lock"

log() {
  echo "[POK-Valheim $(date '+%Y-%m-%d %H:%M:%S')] $*"
}

update_game() {
  log "Acquiring update lock..."
  exec 200>"${LOCK_FILE}"
  flock 200
  log "Running SteamCMD update for Valheim Dedicated Server (AppID 896660)..."
  "${STEAMCMD_DIR}/steamcmd.sh" \
    +@sSteamCmdForcePlatformType linux \
    +force_install_dir "${VALHEIM_DIR}" \
    +login anonymous \
    +app_update 896660 validate \
    +quit

  # Extract installed buildid for the manager UI
  local acf="${VALHEIM_DIR}/steamapps/appmanifest_896660.acf"
  if [[ -f "${acf}" ]]; then
    local buildid
    buildid=$(grep -m1 '"buildid"' "${acf}" | sed -E 's/.*"buildid"[[:space:]]+"([0-9]+)".*/\1/' || true)
    if [[ -n "${buildid}" ]]; then
      printf '{"buildId":"%s","updatedAt":"%s"}\n' "${buildid}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "${VALHEIM_DIR}/.pok_build.json"
      log "Installed Valheim Build ID: ${buildid}"
    fi
  fi
  flock -u 200
  exec 200>&-
}

mkdir -p "${VALHEIM_DIR}" "${CONFIG_DIR}/worlds_local"

# Ensure game files exist or update is requested
if [[ "${UPDATE_ONLY:-false}" == "true" ]]; then
  update_game
  log "Update-only mode complete. Exiting."
  exit 0
fi

if [[ "${UPDATE_ON_START:-true}" == "true" ]] || [[ ! -x "${VALHEIM_DIR}/valheim_server.x86_64" ]]; then
  update_game
else
  log "Skipping SteamCMD update on start (UPDATE_ON_START=false)."
fi

if [[ ! -x "${VALHEIM_DIR}/valheim_server.x86_64" ]]; then
  log "ERROR: valheim_server.x86_64 not found in ${VALHEIM_DIR}!"
  exit 1
fi

# Ensure admin/banned/permitted list files exist
touch "${CONFIG_DIR}/adminlist.txt" "${CONFIG_DIR}/bannedlist.txt" "${CONFIG_DIR}/permittedlist.txt"

# Validate password length (Valheim requires >= 5 chars)
if [[ ${#SERVER_PASS} -lt 5 ]]; then
  log "WARNING: SERVER_PASS must be at least 5 characters. Falling back to 'pokvalheim'."
  SERVER_PASS="pokvalheim"
fi

# Build launch arguments
ARGS=(
  -name "${SERVER_NAME}"
  -port "${SERVER_PORT}"
  -world "${WORLD_NAME}"
  -password "${SERVER_PASS}"
  -savedir "${CONFIG_DIR}"
  -public "${SERVER_PUBLIC}"
  -saveinterval "${SAVE_INTERVAL}"
  -backups "${BACKUPS}"
  -backupshort "${BACKUPSHORT}"
  -backuplong "${BACKUPLONG}"
)

if [[ "${CROSSPLAY:-false}" == "true" ]]; then
  ARGS+=(-crossplay)
fi

if [[ -n "${PRESET:-}" ]]; then
  ARGS+=(-preset "${PRESET}")
fi

if [[ -n "${MODIFIER_COMBAT:-}" ]]; then
  ARGS+=(-modifier combat "${MODIFIER_COMBAT}")
fi
if [[ -n "${MODIFIER_DEATHPENALTY:-}" ]]; then
  ARGS+=(-modifier deathpenalty "${MODIFIER_DEATHPENALTY}")
fi
if [[ -n "${MODIFIER_RESOURCES:-}" ]]; then
  ARGS+=(-modifier resources "${MODIFIER_RESOURCES}")
fi
if [[ -n "${MODIFIER_RAIDS:-}" ]]; then
  ARGS+=(-modifier raids "${MODIFIER_RAIDS}")
fi
if [[ -n "${MODIFIER_PORTALS:-}" ]]; then
  ARGS+=(-modifier portals "${MODIFIER_PORTALS}")
fi

if [[ "${KEY_NOBUILDCOST:-false}" == "true" ]]; then
  ARGS+=(-setkey nobuildcost)
fi
if [[ "${KEY_PLAYEREVENTS:-false}" == "true" ]]; then
  ARGS+=(-setkey playerevents)
fi
if [[ "${KEY_PASSIVEMOBS:-false}" == "true" ]]; then
  ARGS+=(-setkey passivemobs)
fi
if [[ "${KEY_NOMAP:-false}" == "true" ]]; then
  ARGS+=(-setkey nomap)
fi
if [[ "${KEY_FIRE:-false}" == "true" ]]; then
  ARGS+=(-setkey fire)
fi
if [[ "${KEY_DUNGEONBUILD:-false}" == "true" ]]; then
  ARGS+=(-setkey dungeonbuild)
fi

if [[ -n "${EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_ARR=(${EXTRA_ARGS})
  ARGS+=("${EXTRA_ARR[@]}")
fi

export LD_LIBRARY_PATH="${VALHEIM_DIR}/linux64:${LD_LIBRARY_PATH:-}"
export SteamAppId=892970

# Optional per-server BepInEx mod loader (isolated in /config/mods)
if [[ "${MODS_ENABLED:-false}" == "true" ]] && [[ -f "${CONFIG_DIR}/mods/BepInEx/core/BepInEx.Preloader.dll" ]]; then
  log "BepInEx mod loader ENABLED from ${CONFIG_DIR}/mods/BepInEx"
  export DOORSTOP_ENABLE=TRUE
  export DOORSTOP_ENABLED=1
  export DOORSTOP_INVOKE_DLL_PATH="${CONFIG_DIR}/mods/BepInEx/core/BepInEx.Preloader.dll"
  export DOORSTOP_TARGET_ASSEMBLY="${CONFIG_DIR}/mods/BepInEx/core/BepInEx.Preloader.dll"
  export DOORSTOP_CORLIB_OVERRIDE_PATH="${CONFIG_DIR}/mods/unstripped_corlib"
  export LD_LIBRARY_PATH="${CONFIG_DIR}/mods/doorstop_libs:${LD_LIBRARY_PATH}"
  export LD_PRELOAD="libdoorstop_x64.so:${LD_PRELOAD:-}"
fi

SERVER_PID=""

shutdown_handler() {
  log "Received shutdown signal — sending SIGINT to Valheim server for graceful world save..."
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill -SIGINT "${SERVER_PID}"
    wait "${SERVER_PID}" || true
  fi
  log "Valheim server stopped cleanly."
  exit 0
}

trap shutdown_handler SIGINT SIGTERM

log "Starting Valheim Dedicated Server: '${SERVER_NAME}' | World: '${WORLD_NAME}' | Port: ${SERVER_PORT}/udp | Crossplay: ${CROSSPLAY}"
cd "${VALHEIM_DIR}"
./valheim_server.x86_64 "${ARGS[@]}" &
SERVER_PID=$!

wait "${SERVER_PID}"
EXIT_CODE=$?
log "Valheim server exited with code ${EXIT_CODE}."
exit "${EXIT_CODE}"
