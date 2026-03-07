# Stage 1: Build frontend (Angular)
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build
# Normalize output to /out (Angular may output dist/, dist/frontend/browser/, or dist/browser/)
RUN mkdir -p /out && (cp -r dist/frontend/browser/. /out/ 2>/dev/null || cp -r dist/browser/. /out/ 2>/dev/null || cp -r dist/. /out/)

# Stage 2: Build backend (Go)
FROM golang:1.25-alpine AS backend
WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/*.go ./
RUN CGO_ENABLED=0 go build -o pocketbase .

# Stage 3: Runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
ENV POCKETBASE_DATA_DIR=/app/pb_data
EXPOSE 8090
COPY --from=backend /build/pocketbase .
# Frontend: use normalized /out from frontend stage
COPY --from=frontend /out ./pb_public
ENTRYPOINT ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
