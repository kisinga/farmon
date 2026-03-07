# Farm Monitor Scripts Reference

## Overview

Clean, single-purpose scripts with no duplication.

## Script Naming Convention

- `setup_*.sh` - One-time installation scripts
- `deploy.sh` - Deployment workflow
- `sync_*.sh` - Sync operations

## Scripts

### `setup_farm_pi.sh`
**Purpose:** Initial Pi setup
**When:** Once on fresh Pi
**What it does:**
- Installs Docker
- Clones repository
- Creates data directories
- Starts services
- Calls `sync_config.sh` for initial config

**Usage:**
```bash
curl -sSL https://github.com/kisinga/farmon/raw/main/pi/setup_farm_pi.sh | bash
```

---

### `setup_gateway.sh`
**Purpose:** Install LoRaWAN gateway HAT drivers
**When:** Once after hardware installation
**Requires:** sudo
**What it does:**
- Installs chirpstack-concentratord
- Installs chirpstack-mqtt-forwarder
- Configures systemd services
- Starts gateway services

**Usage:**
```bash
sudo bash setup_gateway.sh
```

---

### `deploy.sh`
**Purpose:** Full deployment workflow
**When:** After pushing changes to git
**What it does:**
1. Git pull
2. Stop services
3. Sync config files (calls `sync_config.sh`)
4. Start services
5. Show status

**Usage:**
```bash
cd ~/farm/pi
bash deploy.sh
```

---

### `sync_config.sh`
**Purpose:** Sync config files to running services
**When:**
- Called by `deploy.sh` and `setup_farm_pi.sh`
- Manually when testing local changes
- When config is out of sync

**What it does:**
- Syncs `flows.json`, `settings.js`, `package.json`
- Only copies changed files (unless `--force`)
- Intelligently detects package.json changes (won't reinstall packages unless dependencies actually changed)
- Restarts Node-RED if needed

**Usage:**
```bash
bash sync_config.sh          # sync changed files only (recommended)
bash sync_config.sh --force  # force copy all files regardless of timestamps
```

**Note:** Using `--force` won't reinstall packages unless `package.json` content actually changed.

## Workflow Examples

### Initial Setup
```bash
# On Pi
curl -sSL https://github.com/kisinga/farmon/raw/main/pi/setup_farm_pi.sh | bash
sudo bash ~/farm/pi/setup_gateway.sh
```

### Deploy Changes
```bash
# On dev machine
git add . && git commit -m "update" && git push

# On Pi
cd ~/farm/pi
bash deploy.sh
```

### Quick Config Test
```bash
# On Pi - edit files directly
vim ~/farm/pi/nodered/flows.json
bash sync_config.sh
```

## Design Principles

1. **Single responsibility** - Each script does one thing
2. **No duplication** - `sync_config.sh` is the single source of truth for file syncing
3. **Composable** - Scripts call each other when appropriate
4. **Clear naming** - Name indicates purpose and when to use
5. **Fail fast** - `set -e` stops on errors
