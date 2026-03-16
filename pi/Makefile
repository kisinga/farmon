# FarMon: PocketBase backend + Angular frontend.
# Run from pi/ directory. No Docker required.
#
# Quick start:
#   make frontend-deps   (once, after clone)
#   make build           (builds backend binary)
#   ./backend/pocketbase serve --http=0.0.0.0:8090
#
# Full build with frontend:
#   make all
#   make install DESTDIR=/opt/farmon

.PHONY: build all frontend backend check-go frontend-deps install clean

# Default: build backend only (dev workflow — frontend served separately or pre-built).
build: backend
	@echo "Backend binary: backend/pocketbase"

# Full build: frontend + backend
all: frontend backend
	@mkdir -p backend/pb_public
	@cp -r frontend/dist/browser/. backend/pb_public/
	@echo "Built. Run: ./backend/pocketbase serve --http=0.0.0.0:8090"

# Install frontend deps (run once after clone or when package.json/package-lock.json change)
frontend-deps:
	cd frontend && npm ci

# Build frontend only (run 'make frontend-deps' first if node_modules missing)
frontend:
	cd frontend && npm run build

# Verify go binary matches current machine (avoid "Exec format error" from wrong-arch go)
check-go:
	@command -v go >/dev/null 2>&1 || { echo "ERROR: go not in PATH. Install Go for this machine (e.g. https://go.dev/dl/)"; exit 1; }
	@go version >/dev/null 2>&1 || { echo "ERROR: 'go' fails to run (often wrong-arch binary). Check: file $$(which go) and uname -m"; exit 1; }

# Build backend only (current OS/arch). CGO_ENABLED=0 for a fully static binary.
backend: check-go
	cd backend && CGO_ENABLED=0 go build -o pocketbase .

# Install to a destination directory (for systemd deployment)
install: all
	@mkdir -p $(DESTDIR)
	cp backend/pocketbase $(DESTDIR)/farmon
	cp -r backend/pb_public $(DESTDIR)/pb_public
	cp -r backend/pb_migrations $(DESTDIR)/pb_migrations
	@echo "Installed to $(DESTDIR). Run: $(DESTDIR)/farmon serve --http=0.0.0.0:8090"

clean:
	rm -f backend/pocketbase
	rm -rf backend/pb_public
