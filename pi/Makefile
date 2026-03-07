# pi stack: PocketBase backend + Angular frontend. Run from pi/ directory.
# Builds for current architecture only. Run 'make dist' then 'docker compose up -d'.

.PHONY: build frontend backend dist check-go

# Default: build backend for host (dev). Run after 'make frontend' if you need pb_public.
build: backend
	@echo "Backend binary: backend/pocketbase"

# Build frontend only
frontend:
	cd frontend && npm ci && npm run build

# Verify go binary matches current machine (avoid "Exec format error" from wrong-arch go)
check-go:
	@command -v go >/dev/null 2>&1 || { echo "ERROR: go not in PATH. Install Go for this machine (e.g. https://go.dev/dl/)"; exit 1; }
	@go version >/dev/null 2>&1 || { echo "ERROR: 'go' fails to run (often wrong-arch binary). Check: file $$(which go) and uname -m"; exit 1; }

# Build backend only (current OS/arch). CGO_ENABLED=0 so binary is static and runs in Alpine Docker.
backend: check-go
	cd backend && CGO_ENABLED=0 go build -o pocketbase .

# Prepare dist/ for Docker: frontend + backend for current arch. Then: docker compose up -d
dist: frontend backend
	@mkdir -p dist/pb_public
	@cp backend/pocketbase dist/
	@cp -r frontend/dist/browser/. dist/pb_public/
	@echo "Built dist/ for current arch. Run: docker compose up -d"
