#!/bin/bash

# Farm Monitoring System - Raspberry Pi Setup Script
# 
# This script automates the complete setup of a Raspberry Pi for farm monitoring:
# 1. System preparation and updates
# 2. Tailscale VPN installation and setup  
# 3. Coolify installation for container management
# 4. WiFi hotspot setup for Heltec device connectivity
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
PI_USER="pi"
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
        network-manager \
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
    # Support non-interactive setup via TS_AUTHKEY if provided; otherwise try to reuse existing login
    if [[ -n "${TS_AUTHKEY:-}" ]]; then
        sudo tailscale up --authkey "$TS_AUTHKEY" --ssh --hostname "farm-pi" || true
    else
        sudo tailscale up --ssh --hostname "farm-pi" || true
    fi

    # If still not logged in, prompt once with clear message
    if ! tailscale status >/dev/null 2>&1; then
        echo ""
        echo -e "${YELLOW}Tailscale requires authentication.${NC}"
        echo -e "Run: ${BOLD}sudo tailscale up --authkey <tskey> --ssh --hostname farm-pi${NC}"
        echo -e "or authenticate via the interactive flow.${NC}"
        echo ""
    fi
    
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
    log_success "Tailscale setup complete. Pi IP: $TAILSCALE_IP"
}

setup_coolify() {
    echo -e "${BOLD}${BLUE}=== Coolify Installation ===${NC}"
    
    log_info "Installing Coolify..."
    curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
    
    log_info "Waiting for Coolify to start..."
    sleep 30
    
    echo ""
    echo -e "${YELLOW}Coolify Installation Complete!${NC}"
    echo -e "${CYAN}Access Coolify at: http://localhost:8000${NC}"
    echo -e "${CYAN}Or via Tailscale: http://$TAILSCALE_IP:8000${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "1. Open Coolify in your browser"
    echo -e "2. Complete initial setup"
    echo -e "3. Add this Pi as a server using Tailscale IP"
    echo -e "4. Deploy the farm monitoring stack"
    echo ""
    
    read -p "Press Enter after setting up Coolify and deploying the Docker stack..."
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


verify_setup() {
    echo -e "${BOLD}${BLUE}=== Setup Verification ===${NC}"
    
    # Check Docker
    if docker ps >/dev/null 2>&1; then
        log_success "Docker is running"
    else
        log_error "Docker is not running properly"
    fi
    
    # Check Tailscale
    if tailscale status >/dev/null 2>&1; then
        log_success "Tailscale is connected"
    else
        log_warning "Tailscale may not be properly configured"
    fi
    
 
    
    echo ""
    echo -e "${BOLD}${GREEN}=== Setup Summary ===${NC}"
    echo -e "${CYAN}Tailscale IP:${NC} $(tailscale ip -4 2>/dev/null || echo 'Not available')"
    echo -e "${CYAN}Coolify:${NC} http://$(tailscale ip -4 2>/dev/null || echo 'localhost'):8000"
    
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
    setup_coolify
    verify_setup
    
    echo -e "${BOLD}${GREEN}Setup complete! Your Pi is ready for farm monitoring.${NC}"
    echo -e "${YELLOW}Remember to configure your Heltec devices to connect to the 'PiHotspot' network.${NC}"
}

# Allow script to be sourced for testing
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
