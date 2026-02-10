# Build stage — compile an OTP release
FROM elixir:1.16-alpine AS builder
ENV MIX_ENV=prod
WORKDIR /app

# Install hex + rebar (Elixir build tools)
RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs ./
RUN mix deps.get --only prod && mix deps.compile

COPY config config
COPY lib lib
RUN mix release

# Run stage — includes yt-dlp for watch history scraping
FROM alpine:3.19
RUN apk add --no-cache libstdc++ openssl ncurses-libs python3 py3-pip ffmpeg
RUN pip3 install --break-system-packages yt-dlp

COPY --from=builder /app/_build/prod/rel/youtube_poller /app
ENTRYPOINT ["/app/bin/youtube_poller", "start"]
