# Pre-built path: run `make dist` from pi/ (builds for current arch). Then: docker compose up -d
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
ENV POCKETBASE_DATA_DIR=/app/pb_data
EXPOSE 8090
COPY dist/pocketbase .
COPY dist/pb_public ./pb_public
ENTRYPOINT ["./pocketbase", "serve", "--http=0.0.0.0:8090"]

# ------------------------------------------------------------------------------
# Build-on-device (e.g. on Pi without pre-built dist): uncomment below and
# comment out the COPY dist/ lines above; then use COPY --from=backend and --from=frontend.
# ------------------------------------------------------------------------------
# FROM node:20-alpine AS frontend
# WORKDIR /app/frontend
# COPY frontend/package.json frontend/package-lock.json* ./
# RUN npm ci
# COPY frontend/ .
# RUN npm run build
# RUN mkdir -p /out && (cp -r dist/frontend/browser/. /out/ 2>/dev/null || cp -r dist/browser/. /out/ 2>/dev/null || cp -r dist/. /out/)
#
# FROM golang:1.25-alpine AS backend
# WORKDIR /build
# COPY backend/go.mod backend/go.sum ./
# RUN go mod download
# COPY backend/ ./
# RUN CGO_ENABLED=0 go build -o pocketbase .
#
# Then in the runtime stage above, replace:
#   COPY dist/pocketbase .
#   COPY dist/pb_public ./pb_public
# with:
#   COPY --from=backend /build/pocketbase .
#   COPY --from=frontend /out ./pb_public
# And set build context to . (pi/) so frontend/ and backend/ are available.
