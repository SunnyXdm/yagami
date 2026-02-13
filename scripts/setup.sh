#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Yagami — Interactive Setup Wizard
#  Everything runs inside Docker containers. No local Python,
#  Go, Elixir, or Rust installation required.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No colour

check()  { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()   { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
fail()   { printf "${RED}✗${NC} %s\n" "$*"; }
info()   { printf "${CYAN}→${NC} %s\n" "$*"; }
header() { printf "\n${BOLD}─── %s ───${NC}\n" "$*"; }

# ── Banner ───────────────────────────────────────────────────
echo ""
printf "${BOLD}"
echo "╔═══════════════════════════════════════════╗"
echo "║          Yagami — Setup Wizard            ║"
echo "║   YouTube Activity Monitor → Telegram     ║"
echo "╚═══════════════════════════════════════════╝"
printf "${NC}"
echo ""

# ── Check prerequisites ─────────────────────────────────────
echo "Checking prerequisites..."
missing=()

command -v docker >/dev/null 2>&1 || missing+=("docker")
if command -v "docker compose" >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker compose >/dev/null 2>&1; then
    COMPOSE="docker compose"
else
    missing+=("docker compose")
fi

if [ ${#missing[@]} -gt 0 ]; then
    fail "Missing: ${missing[*]}"
    echo "  Install Docker Desktop: https://docs.docker.com/get-docker/"
    exit 1
fi
check "Docker found"
echo ""

# ── .env file ────────────────────────────────────────────────
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        check "Created .env from .env.example"
    else
        fail ".env.example not found. Are you in the yagami project root?"
        exit 1
    fi
else
    check ".env already exists"
fi

# ── Helper: read a value from .env ───────────────────────────
get_env() {
    local key="$1"
    local val
    val=$(grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d'=' -f2- | sed 's/^["'"'"']//;s/["'"'"']$//')
    echo "$val"
}

# ── Helper: set a value in .env ──────────────────────────────
set_env() {
    local key="$1"
    local val="$2"
    if grep -qE "^${key}=" .env 2>/dev/null; then
        # Use a different delimiter to avoid issues with slashes in values
        sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
    else
        echo "${key}=${val}" >> .env
    fi
}

# ═════════════════════════════════════════════════════════════
#  Step 1: Google OAuth
# ═════════════════════════════════════════════════════════════
header "Step 1: Google OAuth Credentials"

client_id=$(get_env GOOGLE_CLIENT_ID)
client_secret=$(get_env GOOGLE_CLIENT_SECRET)
refresh_token=$(get_env GOOGLE_REFRESH_TOKEN)

if [ -n "$refresh_token" ] && [ "$refresh_token" != "" ]; then
    check "Google refresh token already set"
    echo ""
    read -p "  Re-run OAuth setup anyway? (y/N): " redo_oauth
    redo_oauth=${redo_oauth:-n}
else
    redo_oauth="y"
fi

if [ "$redo_oauth" = "y" ] || [ "$redo_oauth" = "Y" ]; then
    if [ -z "$client_id" ] || [ "$client_id" = "your_google_oauth_client_id" ]; then
        echo ""
        echo "  You need Google OAuth credentials first."
        echo ""
        info "Quick guide:"
        echo "  1. Go to https://console.cloud.google.com → create a project"
        echo "  2. Enable 'YouTube Data API v3' in the API Library"
        echo "  3. Go to OAuth Consent Screen → External → add your Gmail as test user"
        echo "  4. Go to Credentials → Create OAuth client ID (Web application)"
        echo "  5. Add redirect URI: http://localhost:8765/callback"
        echo "  6. Copy the Client ID and Client Secret"
        echo ""
        read -p "  Enter your Google Client ID: " client_id
        read -p "  Enter your Google Client Secret: " client_secret
        set_env "GOOGLE_CLIENT_ID" "$client_id"
        set_env "GOOGLE_CLIENT_SECRET" "$client_secret"
        check "Saved to .env"
    fi

    echo ""
    info "Starting OAuth flow (runs inside Docker — no local Python needed)..."
    echo ""

    # Start postgres first (oauth-setup.py saves to .env, not DB, but we keep it
    # available in case the script evolves)
    ${COMPOSE} up -d postgres 2>/dev/null || true
    sleep 2

    # Run oauth-setup.py inside a temporary Python container
    # Mount the project root so the script can read/write .env
    docker run --rm -it \
        --network host \
        -v "$(pwd)":/app \
        -w /app \
        -e GOOGLE_CLIENT_ID="$client_id" \
        -e GOOGLE_CLIENT_SECRET="$client_secret" \
        python:3.12-slim \
        python scripts/oauth-setup.py

    # Re-read the token in case it was written
    refresh_token=$(get_env GOOGLE_REFRESH_TOKEN)
    if [ -n "$refresh_token" ] && [ "$refresh_token" != "" ]; then
        check "OAuth setup complete"
    else
        warn "Refresh token not saved — you may need to re-run the setup"
    fi
fi

# ═════════════════════════════════════════════════════════════
#  Step 2: Telegram Session
# ═════════════════════════════════════════════════════════════
header "Step 2: Telegram API Credentials"

api_id=$(get_env TELEGRAM_API_ID)
api_hash=$(get_env TELEGRAM_API_HASH)
session_string=$(get_env TELEGRAM_SESSION_STRING)

if [ -n "$session_string" ] && [ "$session_string" != "" ]; then
    check "Telegram session string already set"
    echo ""
    read -p "  Re-generate session string? (y/N): " redo_session
    redo_session=${redo_session:-n}
else
    redo_session="y"
fi

if [ "$redo_session" = "y" ] || [ "$redo_session" = "Y" ]; then
    if [ -z "$api_id" ] || [ "$api_id" = "12345678" ]; then
        echo ""
        echo "  You need Telegram API credentials first."
        echo ""
        info "Quick guide:"
        echo "  1. Go to https://my.telegram.org"
        echo "  2. Log in with your phone number"
        echo "  3. Click 'API Development Tools'"
        echo "  4. Create an application (any name/platform)"
        echo "  5. Copy the API ID (number) and API Hash (hex string)"
        echo ""
        read -p "  Enter your Telegram API ID: " api_id
        read -p "  Enter your Telegram API Hash: " api_hash
        set_env "TELEGRAM_API_ID" "$api_id"
        set_env "TELEGRAM_API_HASH" "$api_hash"
        check "Saved to .env"
    fi

    echo ""
    info "Generating Telegram session string (runs inside Docker)..."
    echo "  You'll be asked for your phone number and a verification code."
    echo ""

    # Run gen-session.py inside a temporary Python container with Telethon
    session_output=$(docker run --rm -i \
        -v "$(pwd)/scripts":/scripts \
        -e TELEGRAM_API_ID="$api_id" \
        -e TELEGRAM_API_HASH="$api_hash" \
        python:3.12-slim \
        bash -c "pip install -q telethon && python /scripts/gen-session.py" 2>&1) || true

    echo "$session_output"

    echo ""
    read -p "  Paste the session string here (or press Enter to skip): " session_string
    if [ -n "$session_string" ]; then
        set_env "TELEGRAM_SESSION_STRING" "$session_string"
        check "Session string saved to .env"
    else
        warn "No session string provided — set TELEGRAM_SESSION_STRING in .env manually"
    fi
fi

# ═════════════════════════════════════════════════════════════
#  Step 3: YouTube Cookies
# ═════════════════════════════════════════════════════════════
header "Step 3: YouTube Cookies (for Watch History)"

echo "  Watch history requires browser cookies (the YouTube API doesn't support it)."
echo ""
info "To export cookies:"
echo "  1. Install the 'Get cookies.txt LOCALLY' browser extension"
echo "  2. Go to youtube.com (make sure you're logged in)"
echo "  3. Export cookies → save as config/cookies.txt"
echo ""

mkdir -p config
if [ -f config/cookies.txt ]; then
    cookie_lines=$(wc -l < config/cookies.txt | tr -d ' ')
    check "config/cookies.txt found (${cookie_lines} lines)"
else
    warn "config/cookies.txt not found — watch history won't work without it"
    echo "  You can add it later and restart the services."
fi

# ═════════════════════════════════════════════════════════════
#  Step 4: Telegram Channels
# ═════════════════════════════════════════════════════════════
header "Step 4: Telegram Channels"

chat_likes=$(get_env TELEGRAM_CHAT_ID_LIKES)
chat_history=$(get_env TELEGRAM_CHAT_ID_WATCH_HISTORY)
admin_id=$(get_env TELEGRAM_ADMIN_USER_ID)

if [ -n "$chat_likes" ] && [ "$chat_likes" != "-1001234567890" ]; then
    check "Channel IDs already configured"
else
    echo "  Create 2 Telegram channels and get their chat IDs."
    echo ""
    info "How to get a channel's chat ID:"
    echo "  1. Create a channel in Telegram"
    echo "  2. Forward a message from it to @userinfobot"
    echo "  3. The bot replies with the chat ID (starts with -100)"
    echo ""
    info "To get your personal user ID:"
    echo "  Send any message directly to @userinfobot"
    echo ""

    read -p "  Enter Likes channel ID (e.g., -1001234567890): " chat_likes
    read -p "  Enter Watch History channel ID: " chat_history
    read -p "  Enter your Telegram user ID (admin): " admin_id

    [ -n "$chat_likes" ]   && set_env "TELEGRAM_CHAT_ID_LIKES" "$chat_likes"
    [ -n "$chat_history" ] && set_env "TELEGRAM_CHAT_ID_WATCH_HISTORY" "$chat_history"
    [ -n "$admin_id" ]     && set_env "TELEGRAM_ADMIN_USER_ID" "$admin_id"

    check "Channel IDs saved to .env"
fi

# ═════════════════════════════════════════════════════════════
#  Step 5: Database Password
# ═════════════════════════════════════════════════════════════
header "Step 5: Database Password"

db_pass=$(get_env DB_PASSWORD)
if [ "$db_pass" = "changeme_use_a_strong_random_password" ] || [ -z "$db_pass" ]; then
    new_pass=$(openssl rand -base64 24 2>/dev/null || head -c 24 /dev/urandom | base64)
    set_env "DB_PASSWORD" "$new_pass"
    check "Generated secure database password"
else
    check "Database password already set"
fi

# ═════════════════════════════════════════════════════════════
#  Step 6: Launch
# ═════════════════════════════════════════════════════════════
header "Ready to Launch"

echo ""
echo "  Your .env is configured. Here's a summary:"
echo ""

# Show config status
show_status() {
    local val
    val=$(get_env "$1")
    if [ -n "$val" ] && [ "$val" != "$2" ]; then
        check "$1"
    else
        fail "$1 — not set"
    fi
}

show_status "GOOGLE_CLIENT_ID"              "your_google_oauth_client_id"
show_status "GOOGLE_CLIENT_SECRET"           "your_google_oauth_client_secret"
show_status "GOOGLE_REFRESH_TOKEN"           ""
show_status "TELEGRAM_API_ID"                "12345678"
show_status "TELEGRAM_API_HASH"              "0123456789abcdef0123456789abcdef"
show_status "TELEGRAM_SESSION_STRING"         ""
show_status "TELEGRAM_CHAT_ID_LIKES"         "-1001234567890"
show_status "TELEGRAM_CHAT_ID_WATCH_HISTORY" "-1001234567892"
show_status "TELEGRAM_ADMIN_USER_ID"         "123456789"
show_status "DB_PASSWORD"                    "changeme_use_a_strong_random_password"

if [ -f config/cookies.txt ]; then
    check "config/cookies.txt"
else
    warn "config/cookies.txt — missing (watch history disabled)"
fi

echo ""
read -p "Start all services? (Y/n): " start_now
start_now=${start_now:-y}

if [ "$start_now" = "y" ] || [ "$start_now" = "Y" ]; then
    echo ""
    info "Building and starting all services..."
    echo ""
    ${COMPOSE} up --build -d

    echo ""
    check "Yagami is running!"
    echo ""
    echo "  ${CYAN}API${NC}:     http://localhost:8080/health"
    echo "  ${CYAN}NATS${NC}:    http://localhost:8222 (monitoring)"
    echo "  ${CYAN}Logs${NC}:    docker compose logs -f"
    echo "  ${CYAN}Stop${NC}:    docker compose down"
    echo ""
else
    echo ""
    echo "  When ready, run:"
    echo "    ${CYAN}docker compose up --build -d${NC}"
    echo ""
fi
