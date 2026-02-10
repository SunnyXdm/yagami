# LEARNING: runtime.exs runs at APPLICATION START, so env vars are available.
# This is where you read System.get_env/1.
import Config

config :youtube_poller,
  database_url: System.get_env("DATABASE_URL", "postgres://yagami:yagami@localhost:5432/yagami"),
  nats_url: System.get_env("NATS_URL", "nats://localhost:4222"),
  google_client_id: System.get_env("GOOGLE_CLIENT_ID"),
  google_client_secret: System.get_env("GOOGLE_CLIENT_SECRET"),
  cookies_path: System.get_env("COOKIES_PATH", "/app/cookies.txt"),
  poll_interval_likes: String.to_integer(System.get_env("POLL_INTERVAL_LIKES", "300")) * 1000,
  poll_interval_subs: String.to_integer(System.get_env("POLL_INTERVAL_SUBS", "3600")) * 1000,
  poll_interval_history: String.to_integer(System.get_env("POLL_INTERVAL_HISTORY", "600")) * 1000
