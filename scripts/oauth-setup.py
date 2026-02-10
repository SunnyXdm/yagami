"""
One-time Google OAuth2 setup — gets refresh token for YouTube API access.

This starts a local HTTP server, opens the Google consent screen in your browser,
and exchanges the authorization code for tokens. The refresh token is then
inserted into the database.

Usage:
    pip install google-auth-oauthlib asyncpg
    python scripts/oauth-setup.py

Prerequisites:
    1. Create a Google Cloud project at https://console.cloud.google.com
    2. Enable "YouTube Data API v3"
    3. Create OAuth 2.0 credentials (Desktop app type)
    4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env
"""
import asyncio
import http.server
import json
import os
import pathlib
import threading
import urllib.parse
import webbrowser

# Resolve .env relative to the project root (parent of scripts/)
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
DOTENV_PATH = PROJECT_ROOT / ".env"


def _load_env_file(path: pathlib.Path):
    """Load a .env file into os.environ. Works without python-dotenv."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip surrounding quotes
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        # Don't overwrite vars already set in the real environment
        if key not in os.environ:
            os.environ[key] = value


_load_env_file(DOTENV_PATH)

import urllib.request

SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
]
REDIRECT_URI = "http://localhost:8765/callback"

auth_code = None
server_event = threading.Event()


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    """Handles the OAuth callback from Google."""

    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>Success!</h1><p>You can close this tab.</p>")
        else:
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>Error</h1><p>No authorization code received.</p>")

        server_event.set()

    def log_message(self, format, *args):
        pass  # Suppress HTTP logs


def exchange_code(client_id: str, client_secret: str, code: str) -> dict:
    """Exchange authorization code for tokens."""
    data = urllib.parse.urlencode({
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


async def save_to_db(db_url: str, access_token: str, refresh_token: str, expires_in: int):
    """Save tokens to the database."""
    try:
        import asyncpg
    except ImportError:
        print("\n⚠️  asyncpg not installed. Printing tokens instead:")
        print(f"   Access token:  {access_token[:20]}...")
        print(f"   Refresh token: {refresh_token}")
        print(f"\n   Insert manually into the oauth_tokens table.")
        return

    conn = await asyncpg.connect(db_url)
    await conn.execute("""
        INSERT INTO oauth_tokens (access_token, refresh_token, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 second' * $3)
        ON CONFLICT ((true)) DO UPDATE SET
            access_token = $1,
            refresh_token = $2,
            expires_at = NOW() + INTERVAL '1 second' * $3,
            updated_at = NOW()
    """, access_token, refresh_token, expires_in)
    await conn.close()
    print("✓ Tokens saved to database")


def main():
    print("=== Google OAuth2 Setup for YouTube API ===\n")

    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    db_password = os.getenv("DB_PASSWORD", "yagami")
    db_url = os.getenv("DATABASE_URL", f"postgres://yagami:{db_password}@localhost:5432/yagami")

    if not client_id or not client_secret:
        print("Error: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.")
        print("Get them from: https://console.cloud.google.com/apis/credentials")
        return

    # Build authorization URL
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    })
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"

    # Start local callback server
    server = http.server.HTTPServer(("localhost", 8765), CallbackHandler)
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()

    # Open browser
    print("Opening browser for Google sign-in...")
    print(f"If it doesn't open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    # Wait for callback
    print("Waiting for authorization...")
    server_event.wait(timeout=120)

    if not auth_code:
        print("Error: No authorization code received.")
        return

    print("✓ Authorization code received")

    # Exchange code for tokens
    tokens = exchange_code(client_id, client_secret, auth_code)

    if "refresh_token" not in tokens:
        print("Error: No refresh token received. Try revoking access at")
        print("https://myaccount.google.com/permissions and running again.")
        return

    print("✓ Tokens received")

    # Save to database
    asyncio.run(save_to_db(
        db_url,
        tokens["access_token"],
        tokens["refresh_token"],
        tokens.get("expires_in", 3600),
    ))

    print("\n✓ OAuth setup complete! The youtube-poller can now access your YouTube data.")


if __name__ == "__main__":
    main()
