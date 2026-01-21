#!/bin/bash
#
# Farm Monitoring System - Configuration Sync Script
# Syncs configuration files from git repo to running services
#
# Usage: bash sync_config.sh [--force]
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_info() { echo -e "  ${CYAN}→${NC} $1"; }
log_success() { echo -e "  ${GREEN}✓${NC} $1"; }
log_warn() { echo -e "  ${YELLOW}!${NC} $1"; }

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    log_error "Run as regular user, not root (script will use sudo when needed)"
    exit 1
fi

# Determine script location and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source and destination paths
NODERED_SRC="$SCRIPT_DIR/nodered"
NODERED_DEST="/srv/farm/nodered"

# Parse arguments
FORCE_SYNC=false
if [[ "$1" == "--force" ]]; then
    FORCE_SYNC=true
    log_info "Force mode enabled - will overwrite all files"
fi

log_info "Syncing configuration files..."

# Check if source directory exists
if [ ! -d "$NODERED_SRC" ]; then
    log_error "Node-RED source directory not found: $NODERED_SRC"
    exit 1
fi

# Check if destination directory exists
if [ ! -d "$NODERED_DEST" ]; then
    log_error "Node-RED data directory not found: $NODERED_DEST"
    log_error "Has the farm stack been set up? Run setup_farm_pi.sh first."
    exit 1
fi

# Sync function - handles file copying with proper checks
sync_file() {
    local src="$1"
    local dest="$2"
    local filename="$(basename "$src")"
    local always_sync="${3:-false}"  # Some files should always sync

    if [ ! -f "$src" ]; then
        log_warn "Source file not found: $filename"
        return 1
    fi

    # Check if sync is needed
    if [ -f "$dest" ] && [ "$FORCE_SYNC" != "true" ] && [ "$always_sync" != "true" ]; then
        if [ "$src" -nt "$dest" ]; then
            log_info "Updating $filename (source is newer)..."
            sudo cp "$src" "$dest"
            sudo chown 1000:1000 "$dest"
            log_success "$filename updated"
            return 0
        else
            log_info "$filename is up to date"
            return 1
        fi
    else
        log_info "Copying $filename..."
        sudo cp "$src" "$dest"
        sudo chown 1000:1000 "$dest"
        log_success "$filename copied"
        return 0
    fi
}

# Track if restart is needed
RESTART_NEEDED=false

# Sync settings.js (always sync when changed or forced)
if sync_file "$NODERED_SRC/settings.js" "$NODERED_DEST/settings.js"; then
    RESTART_NEEDED=true
fi

# Sync flows.json (this is the critical file for dashboard config)
if sync_file "$NODERED_SRC/flows.json" "$NODERED_DEST/flows.json"; then
    RESTART_NEEDED=true
fi

# Sync package.json (triggers npm install if changed)
PACKAGE_UPDATED=false
if [ -f "$NODERED_SRC/package.json" ]; then
    if sync_file "$NODERED_SRC/package.json" "$NODERED_DEST/package.json"; then
        PACKAGE_UPDATED=true
        log_info "Removing node_modules to force reinstall..."
        if [ -d "$NODERED_DEST/node_modules" ]; then
            sudo rm -rf "$NODERED_DEST/node_modules"
            log_success "node_modules removed"
        fi
        RESTART_NEEDED=true
    fi
fi

echo ""

# Restart Node-RED if needed
if [ "$RESTART_NEEDED" = true ]; then
    log_info "Configuration changed, restarting Node-RED..."

    # Check if docker-compose.yml exists
    if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
        cd "$SCRIPT_DIR"

        if $PACKAGE_UPDATED; then
            log_info "Packages updated, Node-RED will install on startup (may take a minute)..."
        fi

        docker compose restart nodered

        log_info "Waiting for Node-RED to start..."
        sleep 5

        # Check if Node-RED is running
        if docker compose ps nodered | grep -q "Up"; then
            log_success "Node-RED restarted successfully"

            # Wait a bit more if packages were updated
            if $PACKAGE_UPDATED; then
                log_info "Waiting for package installation to complete..."
                sleep 15
            fi

            # Show dashboard URL from logs
            log_info "Dashboard started at:"
            docker compose logs --tail 30 nodered | grep "started at" | tail -1 || true

        else
            log_error "Node-RED failed to start"
            log_info "Check logs with: cd $SCRIPT_DIR && docker compose logs nodered"
            exit 1
        fi
    else
        log_warn "docker-compose.yml not found, cannot restart automatically"
        log_info "Restart manually with: cd $SCRIPT_DIR && docker compose restart nodered"
    fi
else
    log_info "No changes detected, Node-RED restart not needed"
fi

log_success "Configuration sync complete"
