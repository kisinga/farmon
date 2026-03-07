# Build in container: docker compose build (context pi/). Optional: make dist then COPY dist/ for faster local builds.
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build
RUN mkdir -p /out && (cp -r dist/frontend/browser/. /out/ 2>/dev/null || cp -r dist/browser/. /out/ 2>/dev/null || cp -r dist/. /out/)

FROM golang:1.25-alpine AS backend
WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -o pocketbase .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
ENV POCKETBASE_DATA_DIR=/app/pb_data
EXPOSE 8090
COPY --from=backend /build/pocketbase .
COPY --from=frontend /out ./pb_public
ENTRYPOINT ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
