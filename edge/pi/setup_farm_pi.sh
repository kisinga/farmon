#!/bin/bash

# Farm Monitoring System - Raspberry Pi Setup Script
#
# Usage: curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash

set -e

# --- Terminal Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# --- Configuration ---
REPO_URL="https://github.com/kisinga/farmon.git"
PI_USER="${USER:-$(whoami)}"
INSTALL_DIR="/home/$PI_USER/farm"

# --- Helper Functions ---
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should NOT be run as root. Please run as user '$PI_USER'."
        exit 1
    fi
}

# --- Main Setup Functions ---

setup_system() {
    echo -e "${BOLD}${BLUE}=== System Setup ===${NC}"
    
    log_info "Updating system packages..."
    sudo apt update && sudo apt upgrade -y
    
    log_info "Installing essential packages..."
    sudo apt install -y \
        git curl wget unzip \
        docker.io docker-compose \
        htop tmux vim nano
    
    log_info "Adding user to docker group..."
    sudo usermod -aG docker "$PI_USER"
    
    log_info "Enabling Docker service..."
    sudo systemctl enable docker
    sudo systemctl start docker
    
    log_success "System setup complete"
}

setup_tailscale() {
    echo -e "${BOLD}${BLUE}=== Tailscale Setup ===${NC}"
    
    if command_exists tailscale; then
        log_info "Tailscale already installed"
    else
        log_info "Installing Tailscale..."
        curl -fsSL https://tailscale.com/install.sh | sh
    fi
    
    log_info "Starting Tailscale..."
    if [[ -n "${TS_AUTHKEY:-}" ]]; then
        sudo tailscale up --authkey "$TS_AUTHKEY" --ssh --hostname "farm-pi" || true
    else
        sudo tailscale up --ssh --hostname "farm-pi" || true
    fi

    if ! tailscale status >/dev/null 2>&1; then
        echo ""
        echo -e "${YELLOW}Tailscale requires authentication.${NC}"
        echo -e "Run: ${BOLD}sudo tailscale up --authkey <tskey> --ssh --hostname farm-pi${NC}"
        echo ""
    fi
    
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
    log_success "Tailscale setup complete. Pi IP: $TAILSCALE_IP"
}

clone_repository() {
    echo -e "${BOLD}${BLUE}=== Repository Setup ===${NC}"
    
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Repository already exists, updating..."
        cd "$INSTALL_DIR"
        git pull
    else
        log_info "Cloning farm monitoring repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    
    cd "$INSTALL_DIR"
    log_success "Repository ready at $INSTALL_DIR"
}

setup_directories() {
    echo -e "${BOLD}${BLUE}=== Creating Data Directories ===${NC}"
    
    log_info "Creating persistent volume directories..."
    sudo mkdir -p /srv/chirpstack/postgres
    sudo mkdir -p /srv/chirpstack/redis
    sudo mkdir -p /srv/mosquitto/data
    sudo mkdir -p /srv/mosquitto/log
    sudo mkdir -p /srv/nodered
    sudo mkdir -p /srv/influxdb/data
    sudo mkdir -p /srv/influxdb/config
    
    log_info "Setting permissions..."
    sudo chown -R 1000:1000 /srv/nodered
    sudo chown -R 1883:1883 /srv/mosquitto
    
    log_success "Data directories ready"
}

deploy_stack() {
    echo -e "${BOLD}${BLUE}=== Deploying Docker Stack ===${NC}"
    
    cd "$INSTALL_DIR/edge/pi"
    
    log_info "Starting services..."
    docker-compose up -d
    
    log_info "Waiting for services to start..."
    sleep 30
    
    log_success "Docker stack deployed"
}

verify_setup() {
    echo -e "${BOLD}${BLUE}=== Setup Verification ===${NC}"
    
    if docker ps >/dev/null 2>&1; then
        log_success "Docker is running"
        echo ""
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        echo ""
    else
        log_error "Docker is not running properly"
    fi
    
    if tailscale status >/dev/null 2>&1; then
        log_success "Tailscale is connected"
    else
        log_warning "Tailscale may not be properly configured"
    fi
    
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo 'localhost')
    
    echo ""
    echo -e "${BOLD}${GREEN}=== Setup Summary ===${NC}"
    echo -e "${CYAN}Tailscale IP:${NC} $TAILSCALE_IP"
    echo ""
    echo -e "${BOLD}Service URLs:${NC}"
    echo -e "  ChirpStack:  http://$TAILSCALE_IP:8080  (admin/admin)"
    echo -e "  Node-RED:    http://$TAILSCALE_IP:1880"
    echo -e "  InfluxDB:    http://$TAILSCALE_IP:8086"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "1. Configure your SX1302 gateway to point to $TAILSCALE_IP:1700 (UDP)"
    echo -e "2. Login to ChirpStack and register your gateway"
    echo -e "3. Create device profiles and register your Heltec devices"
}

# --- Main Execution ---

main() {
    echo -e "${BOLD}${BLUE}"
    echo "=========================================="
    echo "   Farm Monitoring Pi Setup Script"
    echo "=========================================="
    echo -e "${NC}"
    
    check_root
    
    setup_system
    setup_tailscale
    clone_repository
    setup_directories
    deploy_stack
    verify_setup
    
    echo ""
    echo -e "${BOLD}${GREEN}Setup complete! Your Pi is ready for farm monitoring.${NC}"
}

main "$@"
