# Multi-stage build для sing-box-manager-gui

# Stage 1: Сборка фронтенда
FROM node:20-alpine AS frontend-builder

WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Сборка Go бэкенда с встроенным фронтендом
FROM golang:1.24-alpine AS backend-builder

WORKDIR /build

RUN apk add --no-cache git bash

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend-builder /build/web/dist ./web/dist

RUN SKIP_FRONTEND=1 chmod +x build.sh && ./build.sh current

# Stage 3: Финальный образ
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=backend-builder /build/dist/sbm /app/sbm

RUN mkdir -p /data

EXPOSE 9090

CMD ["/app/sbm", "-data", "/data", "-port", "9090"]
