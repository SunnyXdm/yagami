#!/usr/bin/env bash
# Yagami — interactive setup script
set -euo pipefail

echo "╔═══════════════════════════════════════╗"
echo "║       Yagami — Setup Wizard           ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# 1. Check prerequisites
echo "Checking prerequisites..."
missing=()

command -v docker >/dev/null 2>&1 || missing+=("docker")
command -v docker compose >/dev/null 2>&1 && COMPOSE="docker compose" || {
    command -v docker-compose >/dev/null 2>&1 && COMPOSE="docker-compose" || missing+=("docker-compose")
}
command -v python3 >/dev/null 2>&1 || missing+=("python3")

if [ ${#missing[@]} -gt 0 ]; then
    echo "✗ Missing: ${missing[*]}"
    echo "  Install them and run this script again."
    exit 1
fi
echo "✓ All prerequisites found"
echo ""

# 2. Create .env from example
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created .env from .env.example"
    echo "  → Edit .env with your credentials before continuing."
    echo ""
else
    echo "✓ .env already exists"
fi

# 3. Google OAuth setup check
echo ""
echo "─── Step 1: Google OAuth ───"
echo "Have you set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env?"
read -p "(y/n): " google_ready

if [ "$google_ready" = "y" ]; then
    echo "Running OAuth setup..."
    python3 scripts/oauth-setup.py
else
    echo "→ Get credentials from: https://console.cloud.google.com/apis/credentials"
    echo "  1. Create a project → Enable 'YouTube Data API v3'"
    echo "  2. Create OAuth 2.0 credentials (Desktop app)"
    echo "  3. Put client ID & secret in .env"
    echo "  4. Re-run this script"
fi

# 4. Telegram session setup
echo ""
echo "─── Step 2: Telegram Session ───"
echo "Have you set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env?"
read -p "(y/n): " telegram_ready

if [ "$telegram_ready" = "y" ]; then
    echo "Generating Telegram session string..."
    pip3 install telethon --quiet 2>/dev/null || true
    python3 scripts/gen-session.py
    echo ""
    echo "→ Paste the session string into .env as TELEGRAM_SESSION_STRING"
else
    echo "→ Get API credentials from: https://my.telegram.org"
    echo "  1. Log in → API Development Tools"
    echo "  2. Create an application"
    echo "  3. Put API ID & API Hash in .env"
    echo "  4. Re-run this script"
fi

# 5. Cookies setup
echo ""
echo "─── Step 3: YouTube Cookies (for watch history) ───"
echo "Export your YouTube cookies using a browser extension:"
echo "  1. Install 'Get cookies.txt LOCALLY' extension"
echo "  2. Go to youtube.com (make sure you're logged in)"
echo "  3. Export cookies to config/cookies.txt"
echo ""
if [ -f config/cookies.txt ]; then
    echo "✓ config/cookies.txt found"
else
    echo "⚠ config/cookies.txt not found — watch history won't work without it"
fi

# 6. Telegram channels
echo ""
echo "─── Step 4: Telegram Channels ───"
echo "Create 3 Telegram channels and set their chat IDs in .env:"
echo "  TELEGRAM_CHAT_ID_LIKES    — for liked videos"
echo "  TELEGRAM_CHAT_ID_SUBS     — for subscription changes"
echo "  TELEGRAM_CHAT_ID_HISTORY  — for watch history"
echo ""
echo "To get a channel's chat ID:"
echo "  1. Create the channel in Telegram"
echo "  2. Forward a message from the channel to @userinfobot"
echo "  3. The bot will reply with the chat ID (starts with -100)"

# 7. Start services
echo ""
echo "─── Ready? ───"
read -p "Start all services? (y/n): " start_now

if [ "$start_now" = "y" ]; then
    echo "Building and starting..."
    ${COMPOSE:-docker compose} up --build -d
    echo ""
    echo "✓ Yagami is running!"
    echo ""
    echo "  API:     http://localhost:8080/health"
    echo "  NATS:    nats://localhost:4222"
    echo "  Logs:    docker compose logs -f"
    echo "  Stop:    docker compose down"
else
    echo ""
    echo "When ready, run:"
    echo "  docker compose up --build -d"
fi
