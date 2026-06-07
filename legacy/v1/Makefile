# FarMon: PocketBase backend + Angular frontend.
# Run from project root. No Docker required.
#
# Quick start:
#   make frontend-deps   (once, after clone)
#   make build           (builds backend binary)
#   ./backend/pocketbase serve --http=0.0.0.0:8090
#
# Full build with frontend:
#   make all
#   sudo make install   (installs + creates systemd service)

DESTDIR ?= /opt/farmon

.PHONY: build all dev frontend backend check-go frontend-deps board-assets install clean

# Default: build backend only (dev workflow — frontend served separately or pre-built).
build: backend
	@echo "Backend binary: backend/pocketbase"

# Full build: frontend + backend
all: frontend backend
	@mkdir -p backend/pb_public
	@cp -r frontend/dist/browser/. backend/pb_public/
	@echo "Built. Run: ./backend/pocketbase serve --http=0.0.0.0:8090"

# Build and serve backend (dev workflow). Rebuilds on each invocation.
dev: frontend backend
	@mkdir -p backend/pb_public
	@cp -r frontend/dist/browser/. backend/pb_public/
	cd backend && ./pocketbase serve --http=0.0.0.0:8090

# Install frontend deps (run once after clone or when package.json/package-lock.json change)
frontend-deps:
	cd frontend && npm ci

# Copy board breadboard SVGs from firmware targets into frontend public dir.
# Naming convention: public/boards/{model}.svg  (one file per hardware model).
board-assets:
	@mkdir -p frontend/public/boards
	@for target in firmware/targets/*/board; do \
		model=$$(basename $$(dirname $$target)); \
		svg=$$(ls $$target/svg.breadboard.*.svg 2>/dev/null | head -1); \
		[ -n "$$svg" ] && cp "$$svg" "frontend/public/boards/$$model.svg" \
			&& echo "  board-assets: $$model.svg"; \
	done

# Build frontend only (run 'make frontend-deps' first if node_modules missing)
frontend: board-assets
	cd frontend && npm run build

# Verify go binary matches current machine (avoid "Exec format error" from wrong-arch go)
check-go:
	@command -v go >/dev/null 2>&1 || { echo "ERROR: go not in PATH. Install Go for this machine (e.g. https://go.dev/dl/)"; exit 1; }
	@go version >/dev/null 2>&1 || { echo "ERROR: 'go' fails to run (often wrong-arch binary). Check: file $$(which go) and uname -m"; exit 1; }

# Build backend only (current OS/arch). CGO_ENABLED=0 for a fully static binary.
backend: check-go
	cd backend && CGO_ENABLED=0 go build -o pocketbase .

# Install built artifacts and create a systemd service.
# Run 'make all' first (as your user), then 'sudo make install'.
install:
	@test -f backend/pocketbase || { echo "ERROR: Run 'make all' first (as your user, not sudo)"; exit 1; }
	@test -d backend/pb_public || { echo "ERROR: Run 'make all' first (as your user, not sudo)"; exit 1; }
	@mkdir -p $(DESTDIR)
	cp backend/pocketbase $(DESTDIR)/farmon
	cp -r backend/pb_public $(DESTDIR)/pb_public
	cp -r backend/pb_migrations $(DESTDIR)/pb_migrations
	@echo "[Unit]" > /etc/systemd/system/farmon.service
	@echo "Description=FarMon Gateway Service" >> /etc/systemd/system/farmon.service
	@echo "After=network.target" >> /etc/systemd/system/farmon.service
	@echo "" >> /etc/systemd/system/farmon.service
	@echo "[Service]" >> /etc/systemd/system/farmon.service
	@echo "WorkingDirectory=$(DESTDIR)" >> /etc/systemd/system/farmon.service
	@echo "ExecStart=$(DESTDIR)/farmon serve --http=0.0.0.0:8090" >> /etc/systemd/system/farmon.service
	@echo "Restart=on-failure" >> /etc/systemd/system/farmon.service
	@echo "RestartSec=5" >> /etc/systemd/system/farmon.service
	@echo "" >> /etc/systemd/system/farmon.service
	@echo "[Install]" >> /etc/systemd/system/farmon.service
	@echo "WantedBy=multi-user.target" >> /etc/systemd/system/farmon.service
	systemctl daemon-reload
	systemctl enable farmon
	systemctl restart farmon
	@echo "Installed and started farmon service. Check: systemctl status farmon"

clean:
	rm -f backend/pocketbase
	rm -rf backend/pb_public
