#!/bin/bash
#
# Farm Monitoring System - Deploy Script
# Pulls latest changes, stops services, syncs config, and restarts
#
# Usage: bash deploy.sh
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
    log_error "Run as regular user, not root"
    exit 1
fi

# Determine script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if in git repo
if [ ! -d "$SCRIPT_DIR/.git" ] && [ ! -d "$SCRIPT_DIR/../.git" ]; then
    log_error "Not in a git repository"
    exit 1
fi

echo ""
log_info "Deploying latest changes to Farm Monitor stack..."
echo ""

# Navigate to repo root
cd "$SCRIPT_DIR"

# Pull latest changes
log_info "Pulling latest changes from git..."
if git pull; then
    log_success "Git pull complete"
else
    log_error "Git pull failed"
    exit 1
fi

# Stop services
log_info "Stopping services..."
if [ -f "docker-compose.yml" ]; then
    docker compose stop
    log_success "Services stopped"
else
    log_error "docker-compose.yml not found"
    exit 1
fi

# Sync configuration
log_info "Syncing configuration files..."
if bash "$SCRIPT_DIR/sync_config.sh"; then
    log_success "Configuration synced"
else
    log_error "Configuration sync failed"
    exit 1
fi

# Start services
log_info "Starting services..."
docker compose up -d
log_success "Services started"

# Wait for health checks
log_info "Waiting for services to become healthy..."
sleep 10

# Show status
echo ""
log_info "Service status:"
docker compose ps

echo ""
log_success "Deployment complete!"
echo ""
