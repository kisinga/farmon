# pi stack: ChirpStack + PocketBase + Angular
# Run from pi/ directory.

.PHONY: build build-pi frontend backend

# Default: build backend binary (expects frontend already built and in backend/pb_public, or use docker)
build: backend
	@echo "Backend binary: backend/pocketbase"

# Build for Raspberry Pi (linux/arm64). Builds frontend then backend.
build-pi: frontend
	@mkdir -p backend/pb_public
	@(cp -r frontend/dist/browser/. backend/pb_public/ 2>/dev/null) || (cp -r frontend/dist/frontend/browser/. backend/pb_public/ 2>/dev/null) || cp -r frontend/dist/. backend/pb_public/
	cd backend && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o pocketbase-pi .
	@echo "Pi binary: backend/pocketbase-pi — copy to Pi with backend/pb_public/"

# Build frontend only
frontend:
	cd frontend && npm ci && npm run build

# Build backend only (host OS). Ensure pb_public is populated or run after frontend.
backend:
	cd backend && go build -o pocketbase .

# Build backend for 32-bit Pi (e.g. Pi Zero 2 W). Uses same pb_public as build-pi.
build-pi-arm: frontend
	@mkdir -p backend/pb_public
	@(cp -r frontend/dist/browser/. backend/pb_public/ 2>/dev/null) || (cp -r frontend/dist/frontend/browser/. backend/pb_public/ 2>/dev/null) || cp -r frontend/dist/. backend/pb_public/
	cd backend && GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -o pocketbase-pi-arm .
	@echo "Pi 32-bit binary: backend/pocketbase-pi-arm"
