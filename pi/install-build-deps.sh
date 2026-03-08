#!/usr/bin/env bash
# Install Go and Node.js + Angular CLI on the Pi for local builds (no Docker build).
# After this: cd pi && make dist && docker compose up -d
# Usage: ./scripts/install-build-deps.sh [--no-node] [--no-go]

set -e

GO_VERSION="1.26.1"
GO_MIN_VERSION="1.25.5"   # go.mod requirement
GO_BASE="https://go.dev/dl"
NVM_VERSION="v0.40.4"
NVM_INSTALL_URL="https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh"
NODE_VERSION="24"
INSTALL_GO=true
INSTALL_NODE=true

for arg in "$@"; do
  case "$arg" in
    --no-node) INSTALL_NODE=false ;;
    --no-go)   INSTALL_GO=false ;;
    -h|--help)
      echo "Usage: $0 [--no-node] [--no-go]"
      echo "  Installs Go ${GO_VERSION} and Node.js ${NODE_VERSION} (via nvm) + Angular CLI for building pi stack on device."
      exit 0
      ;;
  esac
done

# --- Helpers: validate URL exists (HTTP 200 or 302 redirect) ---
check_url() {
  local url="$1"
  local code
  code=$(curl -f -sI -o /dev/null -w "%{http_code}" --connect-timeout 10 -L "$url" 2>/dev/null || true)
  if [[ "$code" != "200" && "$code" != "302" ]]; then
    echo "ERROR: URL not available (HTTP $code): $url" >&2
    return 1
  fi
  return 0
}

# --- Detect Linux arch for Go tarball (Pi: aarch64 or armv7l) ---
detect_go_arch() {
  local m
  m=$(uname -m 2>/dev/null)
  case "$m" in
    aarch64|arm64)  echo "linux-arm64" ;;
    armv7l|armv6l)  echo "linux-armv6l" ;;
    x86_64)         echo "linux-amd64" ;;
    *)              echo "linux-arm64" ;; # default for Pi
  esac
}

# --- Version comparison: return 0 if $1 >= $2 (e.g. 1.26.1 >= 1.25.5) ---
version_ge() {
  local a="$1" b="$2"
  [[ "$a" == "$b" ]] && return 0
  local winner
  winner=$(printf '%s\n' "$a" "$b" | sort -V | tail -1)
  [[ "$winner" == "$a" ]]
}

# ========== Go ==========
# Ensure go is on PATH for detection (and for rest of script)
for d in /usr/local/go/bin "$HOME/go-install/go/bin"; do
  [[ -x "$d/go" ]] && export PATH="$d:$PATH"
done

GO_SKIP=
if [[ "$INSTALL_GO" == "true" ]] && command -v go &>/dev/null; then
  installed_go=$(go version 2>/dev/null | sed -n 's/.*go\([0-9.]*\).*/\1/p')
  if [[ -n "$installed_go" ]] && version_ge "$installed_go" "$GO_MIN_VERSION"; then
    echo "Go already installed (>= ${GO_MIN_VERSION}): $(go version)"
    GO_SKIP=1
    # Ensure the working go is prepended in ~/.profile so 'make' in new shells uses it
    GO_BIN_DIR=$(dirname "$(command -v go)")
    PROFILE="${HOME}/.profile"
    if [[ -n "$GO_BIN_DIR" ]] && [[ -f "$PROFILE" || -w "$(dirname "$PROFILE")" ]]; then
      if ! grep -q "PATH=\"${GO_BIN_DIR}:\$PATH\"" "$PROFILE" 2>/dev/null; then
        echo "" >> "$PROFILE"
        echo "# Go - prepend so correct arch is used (pi/scripts/install-build-deps.sh)" >> "$PROFILE"
        echo "export PATH=\"${GO_BIN_DIR}:\$PATH\"" >> "$PROFILE"
        grep -q 'GOPATH=' "$PROFILE" 2>/dev/null || echo "export GOPATH=\$HOME/go" >> "$PROFILE"
        echo "Added Go PATH to $PROFILE. Run: source $PROFILE (or log out and back in), then make will work."
      fi
    fi
  fi
fi

if [[ "$INSTALL_GO" == "true" && -z "$GO_SKIP" ]]; then
  GO_ARCH=$(detect_go_arch)
  GO_TAR="go${GO_VERSION}.${GO_ARCH}.tar.gz"
  GO_URL="${GO_BASE}/${GO_TAR}"

  echo "Checking Go download: $GO_URL"
  if ! check_url "$GO_URL"; then
    echo "Try another Go version or arch. See: https://go.dev/dl/" >&2
    exit 1
  fi

  echo "Downloading and installing Go ${GO_VERSION} (${GO_ARCH})..."
  TMP_GO=$(mktemp -d)
  trap 'rm -rf "$TMP_GO"' EXIT
  curl -f -sL -o "$TMP_GO/$GO_TAR" "$GO_URL"

  if command -v sha256sum &>/dev/null; then
    # Optional: verify checksum (from https://go.dev/dl/)
    case "$GO_ARCH" in
      linux-arm64)  want="a290581cfe4fe28ddd737dde3095f3dbeb7f2e4065cab4eae44dfc53b760c2f7" ;;
      linux-armv6l) want="c9937198994dc173b87630a94a0d323442bef81bf7589b1170d55a8ebf759bda" ;;
      linux-amd64)  want="031f088e5d955bab8657ede27ad4e3bc5b7c1ba281f05f245bcc304f327c987a" ;;
      *) want="" ;;
    esac
    if [[ -n "$want" ]]; then
      got=$(sha256sum -b "$TMP_GO/$GO_TAR" | awk '{print $1}')
      if [[ "$got" != "$want" ]]; then
        echo "ERROR: Go tarball checksum mismatch (got $got)" >&2
        exit 1
      fi
    fi
  fi

  if [[ -w /usr/local ]]; then
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf "$TMP_GO/$GO_TAR"
    echo "Go installed to /usr/local/go"
    GO_PROFILE_PATH="/usr/local/go/bin"
  else
    mkdir -p "$HOME/go-install"
    rm -rf "$HOME/go-install/go"
    tar -C "$HOME/go-install" -xzf "$TMP_GO/$GO_TAR"
    echo "Go installed to $HOME/go-install/go"
    export PATH="$HOME/go-install/go/bin:$PATH"
    GO_PROFILE_PATH="\$HOME/go-install/go/bin"
  fi

  # Ensure ~/.profile has Go on PATH and GOPATH (prepend so this install wins)
  PROFILE="$HOME/.profile"
  if [[ -n "$GO_PROFILE_PATH" ]]; then
    if ! grep -q 'go/bin' "$PROFILE" 2>/dev/null; then
      echo "" >> "$PROFILE"
      echo "# Go (added by pi/scripts/install-build-deps.sh)" >> "$PROFILE"
      if [[ "$GO_PROFILE_PATH" == *go-install* ]]; then
        echo "export PATH=\"\$HOME/go-install/go/bin:\$PATH\"" >> "$PROFILE"
      else
        echo "export PATH=\"/usr/local/go/bin:\$PATH\"" >> "$PROFILE"
      fi
      echo "export GOPATH=\$HOME/go" >> "$PROFILE"
      echo "Added Go PATH and GOPATH to $PROFILE. Run: source $PROFILE (or log out and back in)."
    fi
  fi
fi

# Ensure go is on PATH for rest of script
if command -v go &>/dev/null; then
  [[ -z "$GO_SKIP" ]] && echo "Go version: $(go version)"
else
  export PATH="/usr/local/go/bin:$PATH"
  if [[ -d "$HOME/go-install/go/bin" ]]; then
    export PATH="$HOME/go-install/go/bin:$PATH"
  fi
  if ! command -v go &>/dev/null; then
    echo "Add Go to PATH and re-run, or install to /usr/local with sudo." >&2
    exit 1
  fi
fi

# ========== Node.js (nvm) + Angular CLI ==========
if [[ "$INSTALL_NODE" == "true" ]]; then
  # Load nvm if present (so we can detect Node 24)
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    . "$NVM_DIR/nvm.sh"
  fi

  NODE_SKIP=
  if command -v node &>/dev/null && command -v npm &>/dev/null; then
    echo "Node already installed: $(node -v), $(npm -v)"
    NODE_SKIP=1
  fi

  if [[ -z "$NODE_SKIP" ]]; then
    # No node in PATH: install nvm if missing, then Node
    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
      echo "Checking nvm install script: $NVM_INSTALL_URL"
      if ! check_url "$NVM_INSTALL_URL"; then
        echo "nvm install URL not reachable. Install nvm/Node manually then run: npm install -g @angular/cli" >&2
        exit 1
      fi
      echo "Downloading and installing nvm (${NVM_VERSION})..."
      curl -o- "$NVM_INSTALL_URL" | bash
      export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
      . "$NVM_DIR/nvm.sh"
    else
      echo "nvm already installed, loading..."
      . "$NVM_DIR/nvm.sh"
    fi

    # Install Node only if not already using requested version (e.g. 24)
    if ! command -v node &>/dev/null; then
      echo "Installing Node.js ${NODE_VERSION}..."
      nvm install "$NODE_VERSION"
    else
      echo "Node already available: $(node -v), $(npm -v)"
    fi
  fi

  # Ensure nvm is loaded for Angular CLI
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"

  if command -v ng &>/dev/null; then
    echo "Angular CLI already installed: $(ng version 2>/dev/null | head -1 || ng version)"
  else
    echo "Installing Angular CLI globally..."
    npm install -g @angular/cli@latest
    echo "Angular CLI: $(ng version 2>/dev/null | head -1 || ng version)"
  fi
fi

echo ""
echo "Done. Next: cd pi && make dist && docker compose up -d"
