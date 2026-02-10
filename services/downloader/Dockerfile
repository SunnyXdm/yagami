# --- Build stage ---
FROM rust:1.86-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Create dummy main.rs to cache dependency builds
RUN mkdir src && echo "fn main(){}" > src/main.rs
RUN cargo build --release && rm -rf src

# Copy real source and build
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# --- Runtime stage ---
FROM alpine:3.19
RUN apk add --no-cache python3 py3-pip ffmpeg ca-certificates nodejs \
    && pip3 install --break-system-packages yt-dlp

COPY --from=builder /app/target/release/downloader /usr/local/bin/downloader

ENV RUST_LOG=info
CMD ["downloader"]
