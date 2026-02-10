# Build stage — compile Go binary
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /api-gateway ./cmd/server

# Run stage — tiny image with just the binary
FROM alpine:3.19
COPY --from=builder /api-gateway /api-gateway
EXPOSE 8080
ENTRYPOINT ["/api-gateway"]
