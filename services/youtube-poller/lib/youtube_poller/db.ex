defmodule YoutubePoller.DB do
  @moduledoc """
  Database access — thin wrapper around Postgrex queries.

  LEARNING: We use Postgrex directly instead of Ecto (the big ORM) to keep
  things simple and learn raw SQL. The named process (YoutubePoller.DB) lets
  us call Postgrex.query(YoutubePoller.DB, sql, params) from anywhere.
  """

  @doc "Parse DATABASE_URL into Postgrex connection options."
  def config do
    url = Application.get_env(:youtube_poller, :database_url)
    uri = URI.parse(url)
    [user, pass] = String.split(uri.userinfo || "yagami:yagami", ":")

    [
      hostname: uri.host || "localhost",
      port: uri.port || 5432,
      database: String.trim_leading(uri.path || "/yagami", "/"),
      username: user,
      password: pass
    ]
  end

  # --- OAuth tokens ---

  def get_oauth_token do
    case query("SELECT access_token, refresh_token, expires_at FROM oauth_tokens LIMIT 1", []) do
      {:ok, %{rows: [[access, refresh, expires]]}} -> {:ok, access, refresh, expires}
      _ -> {:error, :no_token}
    end
  end

  def update_access_token(access_token, expires_at) do
    query(
      "UPDATE oauth_tokens SET access_token = $1, expires_at = $2, updated_at = NOW()",
      [access_token, expires_at]
    )
  end

  # --- Known likes ---

  def get_known_like_ids do
    {:ok, %{rows: rows}} = query("SELECT video_id FROM known_likes", [])
    MapSet.new(rows, fn [id] -> id end)
  end

  def insert_known_like(video_id) do
    query("INSERT INTO known_likes (video_id) VALUES ($1) ON CONFLICT DO NOTHING", [video_id])
  end

  # --- Known watch history ---

  def get_known_watch_ids do
    {:ok, %{rows: rows}} = query("SELECT video_id FROM known_watch_history", [])
    MapSet.new(rows, fn [id] -> id end)
  end

  def insert_known_watch(video_id) do
    query(
      "INSERT INTO known_watch_history (video_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [video_id]
    )
  end

  # --- Events ---

  def insert_event(event_type, data) do
    query(
      "INSERT INTO events (event_type, metadata) VALUES ($1, $2)",
      [event_type, Jason.encode!(data)]
    )
  end

  # --- Config / Seeding ---

  @doc "Check whether initial seeding has been done for a given key (likes/subs/history)."
  def seeded?(key) when is_binary(key) do
    case query("SELECT 1 FROM config WHERE key = $1", [key]) do
      {:ok, %{num_rows: n}} when n > 0 -> true
      _ -> false
    end
  end

  def mark_seeded!(key) when is_binary(key) do
    query(
      "INSERT INTO config (key, value) VALUES ($1, 'true') ON CONFLICT (key) DO NOTHING",
      [key]
    )
  end

  # --- Private ---

  # LEARNING: The pipe operator |> passes the result of the left side as the
  # first argument to the right side. It makes data transformations readable.
  defp query(sql, params) do
    Postgrex.query(YoutubePoller.DB, sql, params)
  end
end
