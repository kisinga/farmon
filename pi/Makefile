# pi stack: PocketBase backend + Angular frontend. Run from pi/ directory.
#
# Fast path (local machine): make dist-pi → commit dist/ → on Pi: git pull && docker compose up -d
# On-device build: uncomment build stages in backend/Dockerfile, then docker compose build

.PHONY: build build-pi frontend backend dist dist-pi dist-pi-arm

# Default: build backend for host (dev). Run after 'make frontend' if you need pb_public.
build: backend
	@echo "Backend binary: backend/pocketbase"

# Build frontend only
frontend:
	cd frontend && npm ci && npm run build

# Build backend only (host OS)
backend:
	cd backend && go build -o pocketbase .

# --- Pre-built dist for Docker (no build in container) ---
# Produces dist/pocketbase and dist/pb_public/. Commit dist/ and reference from Dockerfile.
# On Pi: git pull && docker compose up -d (build uses COPY dist/).

# dist-pi: Linux arm64 (Raspberry Pi 64-bit). Builds frontend deps + frontend + backend deps + backend.
dist-pi: frontend
	@mkdir -p dist/pb_public
	@cp -r frontend/dist/browser/. dist/pb_public/
	cd backend && go mod download && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ../dist/pocketbase .
	@echo "Built dist/pocketbase (linux/arm64) and dist/pb_public/. Commit dist/ then on Pi: git pull && docker compose up -d"

# dist: Linux amd64 (e.g. local Docker or CI). Same layout as dist-pi.
dist: frontend
	@mkdir -p dist/pb_public
	@cp -r frontend/dist/browser/. dist/pb_public/
	cd backend && go mod download && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../dist/pocketbase .
	@echo "Built dist/pocketbase (linux/amd64) and dist/pb_public/"

# dist-pi-arm: 32-bit Pi (e.g. Pi Zero 2 W)
dist-pi-arm: frontend
	@mkdir -p dist/pb_public
	@cp -r frontend/dist/browser/. dist/pb_public/
	cd backend && go mod download && GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -o ../dist/pocketbase .
	@echo "Built dist/pocketbase (linux/arm) and dist/pb_public/"
