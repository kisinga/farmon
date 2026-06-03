.PHONY: test build build-cloud build-edge tidy ui-build dev run-cloud run-edge

# ── Config (override on the CLI, e.g. `make dev HTTP_ADDR=0.0.0.0:8090`) ──────
ROOT           := ..
SPA_OUT        := ../dist/app/browser           # built Angular SPA, served by Go
HTTP_ADDR      ?= 127.0.0.1:8090
ADMIN_EMAIL    ?= admin@maji.local
ADMIN_PASSWORD ?= majiadmin123

# Env the cloud binary needs to host the SPA + seed a dev admin login.
CLOUD_ENV = MAJI_SPA_DIR=$(SPA_OUT) \
            MAJI_ADMIN_EMAIL=$(ADMIN_EMAIL) \
            MAJI_ADMIN_PASSWORD=$(ADMIN_PASSWORD)

# ── Test / build ─────────────────────────────────────────────────────────────
test:
	go test ./... -race

build: build-cloud build-edge

build-cloud:
	go build -tags cloud -o dist/maji-cloud ./cmd/cloud

build-edge:
	go build -tags edge -o dist/maji-edge ./cmd/edge

tidy:
	go mod tidy

# ── Frontend ─────────────────────────────────────────────────────────────────
# Build the Angular SPA into ../dist/app/browser (the dir the Go server hosts).
ui-build:
	cd $(ROOT) && npx ng build --configuration development

# ── Dev: ONE origin. Go hosts the SPA; ng rebuilds it on file change. ────────
# Single process group; Ctrl-C stops both (concurrently -k).
# Open http://$(HTTP_ADDR) — log in with $(ADMIN_EMAIL) / $(ADMIN_PASSWORD).
# Note: no HMR — Go serves built files, so a rebuild needs a browser refresh.
dev: build-cloud
	cd $(ROOT) && npx concurrently -k -n web,api -c cyan,green \
	  "npx ng build --watch --configuration development" \
	  "cd maji-server && $(CLOUD_ENV) ./dist/maji-cloud serve --http=$(HTTP_ADDR)"

# ── Run (prod-like, single origin): build SPA once, then serve it from Go ────
run-cloud: build-cloud ui-build
	$(CLOUD_ENV) ./dist/maji-cloud serve --http=$(HTTP_ADDR)

run-edge: build-edge
	./dist/maji-edge serve
