#!/bin/bash

# Farm Monitoring System - Raspberry Pi Setup Script
#
# Usage: curl -sSL https://github.com/kisinga/farmon/raw/main/pi/setup_farm_pi.sh | bash

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

TOTAL_STEPS=5
CURRENT_STEP=0

log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_info() { echo -e "  ${CYAN}→${NC} $1"; }
log_success() { echo -e "  ${GREEN}✓${NC} $1"; }

step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo ""
    echo -e "${BOLD}${BLUE}[$CURRENT_STEP/$TOTAL_STEPS] $1${NC}"
    echo -e "${BLUE}$(printf '─%.0s' {1..50})${NC}"
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "Run as regular user, not root."
        exit 1
    fi
}

setup_system() {
    step "System Setup"
    
    log_info "Updating system packages..."
    sudo apt update && sudo apt upgrade -y
    
    log_info "Installing docker and dependencies..."
    sudo apt install -y git curl wget docker.io docker-compose i2c-tools
    
    log_info "Configuring docker..."
    sudo usermod -aG docker "$PI_USER"
    sudo systemctl enable docker
    sudo systemctl start docker
    
    # Enable SPI for SX1302 gateway HAT
    log_info "Checking SPI configuration..."
    if ! grep -q "^dtparam=spi=on" /boot/config.txt 2>/dev/null && \
       ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
        echo "dtparam=spi=on" | sudo tee -a /boot/config.txt >/dev/null 2>/dev/null || \
        echo "dtparam=spi=on" | sudo tee -a /boot/firmware/config.txt >/dev/null
        log_info "SPI enabled - reboot required after setup"
    else
        log_success "SPI already enabled"
    fi
    
    log_success "System ready"
}

setup_tailscale() {
    step "Tailscale VPN"
    
    if ! command -v tailscale &>/dev/null; then
        log_info "Installing Tailscale..."
        curl -fsSL https://tailscale.com/install.sh | sh
    else
        log_info "Tailscale already installed"
    fi
    
    log_info "Connecting to Tailscale..."
    if [[ -n "${TS_AUTHKEY:-}" ]]; then
        sudo tailscale up --authkey "$TS_AUTHKEY" --ssh --hostname "farm-pi" || true
    else
        sudo tailscale up --ssh --hostname "farm-pi" || true
    fi
    
    log_success "Tailscale configured"
}

clone_repository() {
    step "Repository"
    
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Updating existing repository..."
        cd "$INSTALL_DIR" && git pull
    else
        log_info "Cloning repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    
    log_success "Repository ready at $INSTALL_DIR"
}

setup_directories() {
    step "Data Directories"
    
    log_info "Creating volume directories..."
    sudo mkdir -p /srv/farm/{postgres,redis}
    sudo mkdir -p /srv/farm/mosquitto/{data,logs}
    sudo mkdir -p /srv/farm/nodered
    
    log_info "Creating configuration directories..."
    mkdir -p "$INSTALL_DIR/pi/mosquitto"
    
    # Create mosquitto.conf if it doesn't exist
    if [ ! -f "$INSTALL_DIR/pi/mosquitto/mosquitto.conf" ]; then
        log_info "Creating mosquitto.conf..."
        cat > "$INSTALL_DIR/pi/mosquitto/mosquitto.conf" << 'EOF'
# Mosquitto MQTT Broker Configuration
# For Farm Monitoring System

# Persistence
persistence true
persistence_location /mosquitto/data/

# Logging
log_dest file /mosquitto/log/mosquitto.log
log_type all

# Network listeners
listener 1883 0.0.0.0
allow_anonymous true

# Connection settings
max_connections -1
max_inflight_messages 100
max_queued_messages 1000

# Retained messages
retained_persistence true
EOF
    fi
    
    log_info "Setting permissions..."
    sudo chown -R 70:70 /srv/farm/postgres        # postgres user in postgres:15-alpine
    sudo chmod 700 /srv/farm/postgres              # secure directory permissions
    sudo chown -R 1000:1000 /srv/farm/nodered     # node-red user
    sudo chown -R 1883:1883 /srv/farm/mosquitto   # mosquitto user
    
    log_success "Directories ready"
}

deploy_stack() {
    step "Docker Stack"
    
    cd "$INSTALL_DIR/pi"
    
    log_info "Pulling Docker images (this may take a while)..."
    docker-compose pull
    
    log_info "Starting database..."
    docker-compose up -d postgres
    sleep 10
    
    log_info "Starting all services..."
    docker-compose up -d
    
    log_info "Waiting for services to be ready..."
    sleep 15
    
    # Restart ChirpStack to ensure MQTT connection is established
    # (handles race condition where ChirpStack starts before Mosquitto is ready)
    log_info "Ensuring ChirpStack MQTT connection..."
    docker-compose restart chirpstack
    sleep 5
    
    log_info "Verifying Node-RED dashboard packages..."
    # Wait for Node-RED to fully start
    sleep 10
    
    # Check if dashboard package is installed
    if docker exec farm-nodered test -d /data/node_modules/@flowfuse/node-red-dashboard 2>/dev/null; then
        log_success "Dashboard package already installed"
    else
        log_info "Installing Node-RED dashboard packages..."
        docker exec farm-nodered npm install --prefix /data --production 2>&1 | grep -v "npm WARN" || true
        log_info "Restarting Node-RED to load new packages..."
        docker-compose restart nodered
        sleep 10
        log_success "Dashboard packages installed"
    fi
    
    log_success "All services running"
}

print_summary() {
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo 'localhost')
    
    echo ""
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}           Setup Complete!${NC}"
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BOLD}Services:${NC}"
    echo -e "  ChirpStack:  http://$TAILSCALE_IP:8080"
    echo -e "               ${CYAN}admin / admin${NC}"
    echo -e "  Node-RED:    http://$TAILSCALE_IP:1880"
    echo -e "               ${CYAN}admin / farmmon${NC}"
    echo -e "  Dashboard:   http://$TAILSCALE_IP:1880/ui/farm-monitor"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo -e "  1. Run gateway setup: ${CYAN}sudo bash setup_gateway.sh${NC}"
    echo -e "  2. Register gateway in ChirpStack"
    echo -e "  3. Add devices in ChirpStack"
    echo -e "  4. Configure Node-RED flows for your sensors"
    echo ""
}

main() {
    echo ""
    echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}      Farm Monitoring Pi Setup${NC}"
    echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"
    
    check_root
    setup_system
    setup_tailscale
    clone_repository
    setup_directories
    deploy_stack
    print_summary
}

main "$@"
