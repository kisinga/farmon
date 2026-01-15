#!/bin/bash

# Farm Monitoring System - Raspberry Pi Setup Script
#
# Usage: curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

REPO_URL="https://github.com/kisinga/farmon.git"
PI_USER="${USER:-$(whoami)}"
INSTALL_DIR="/home/$PI_USER/farm"

log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "Run as regular user, not root."
        exit 1
    fi
}

setup_system() {
    echo -e "${BOLD}${BLUE}=== System Setup ===${NC}"
    
    log_info "Updating system..."
    sudo apt update && sudo apt upgrade -y
    
    log_info "Installing packages..."
    sudo apt install -y git curl wget docker.io docker-compose
    
    sudo usermod -aG docker "$PI_USER"
    sudo systemctl enable docker
    sudo systemctl start docker
    
    log_success "System ready"
}

setup_tailscale() {
    echo -e "${BOLD}${BLUE}=== Tailscale Setup ===${NC}"
    
    if ! command -v tailscale &>/dev/null; then
        curl -fsSL https://tailscale.com/install.sh | sh
    fi
    
    if [[ -n "${TS_AUTHKEY:-}" ]]; then
        sudo tailscale up --authkey "$TS_AUTHKEY" --ssh --hostname "farm-pi" || true
    else
        sudo tailscale up --ssh --hostname "farm-pi" || true
    fi
    
    log_success "Tailscale configured"
}

clone_repository() {
    echo -e "${BOLD}${BLUE}=== Repository Setup ===${NC}"
    
    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR" && git pull
    else
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    
    log_success "Repository ready"
}

setup_directories() {
    echo -e "${BOLD}${BLUE}=== Creating Directories ===${NC}"
    
    sudo mkdir -p /srv/farm/{postgres,redis}
    sudo mkdir -p /srv/farm/mosquitto/{data,logs}
    sudo mkdir -p /srv/farm/thingsboard/{data,logs}
    
    sudo chown -R 799:799 /srv/farm/thingsboard
    
    log_success "Directories ready"
}

deploy_stack() {
    echo -e "${BOLD}${BLUE}=== Deploying Stack ===${NC}"
    
    cd "$INSTALL_DIR/edge/pi"
    
    # Start database first
    log_info "Starting database..."
    docker-compose up -d postgres
    sleep 10
    
    # Initialize ThingsBoard schema and demo data
    log_info "Initializing ThingsBoard database..."
    docker-compose run --rm -e INSTALL_TB=true -e LOAD_DEMO=true thingsboard
    
    # Start all services
    log_info "Starting all services..."
    docker-compose up -d
    
    log_info "Waiting for services to be ready..."
    sleep 30
    
    log_success "Stack deployed"
}

print_summary() {
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo 'localhost')
    
    echo ""
    echo -e "${BOLD}${GREEN}=== Setup Complete ===${NC}"
    echo ""
    echo -e "${BOLD}Services:${NC}"
    echo -e "  ChirpStack:   http://$TAILSCALE_IP:8080"
    echo -e "                admin / admin"
    echo -e "  ThingsBoard:  http://$TAILSCALE_IP:9090"
    echo -e "                tenant@thingsboard.org / tenant"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo -e "1. Configure SX1302 gateway → $TAILSCALE_IP:1700 (UDP)"
    echo -e "2. Register gateway in ChirpStack"
    echo -e "3. Create ChirpStack → ThingsBoard MQTT integration"
    echo -e "4. Add devices in both platforms"
}

main() {
    echo -e "${BOLD}${BLUE}"
    echo "=========================================="
    echo "   Farm Monitoring Pi Setup"
    echo "=========================================="
    echo -e "${NC}"
    
    check_root
    setup_system
    setup_tailscale
    clone_repository
    setup_directories
    deploy_stack
    print_summary
}

main "$@"
