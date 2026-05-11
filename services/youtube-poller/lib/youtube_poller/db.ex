defmodule YoutubePoller.DB do
  @moduledoc "Postgres access — settings, tokens, known sets, events."

  def config do
    url = System.get_env("DATABASE_URL", "postgres://yagami:yagami@postgres:5432/yagami")
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

  # Settings (mutate; reads go through YoutubePoller.Settings ETS cache)
  def set_setting(key, value) when is_binary(key) do
    query(
      """
      INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
      """,
      [key, to_string(value)]
    )
    YoutubePoller.Settings.reload()
    :ok
  end

  # OAuth tokens
  def get_oauth_token do
    case query("SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE provider='google' LIMIT 1", []) do
      {:ok, %{rows: [[a, r, e]]}} -> {:ok, a, r, e}
      _ -> {:error, :no_token}
    end
  end

  def upsert_oauth_token(provider, access, refresh, expires_at) do
    query(
      """
      INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, scopes)
      VALUES ($1, $2, $3, $4, 'https://www.googleapis.com/auth/youtube.readonly')
      ON CONFLICT (provider) DO UPDATE
        SET access_token=EXCLUDED.access_token,
            refresh_token=EXCLUDED.refresh_token,
            expires_at=EXCLUDED.expires_at,
            updated_at=NOW()
      """,
      [provider, access, refresh, expires_at]
    )
  end

  # Known likes
  def get_known_like_ids do
    {:ok, %{rows: rows}} = query("SELECT video_id FROM known_likes", [])
    MapSet.new(rows, fn [id] -> id end)
  end

  def insert_known_like(video_id, title \\ nil, channel_id \\ nil, channel_title \\ nil, thumb \\ nil) do
    query(
      """
      INSERT INTO known_likes (video_id, title, channel_id, channel_title, thumbnail_url)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
      """,
      [video_id, title, channel_id, channel_title, thumb]
    )
  end

  # Known watch
  def get_known_watch_ids do
    {:ok, %{rows: rows}} = query("SELECT video_id FROM known_watch_history", [])
    MapSet.new(rows, fn [id] -> id end)
  end

  def insert_known_watch(video_id, title \\ nil, channel_id \\ nil, channel_title \\ nil, thumb \\ nil) do
    query(
      """
      INSERT INTO known_watch_history (video_id, title, channel_id, channel_title, thumbnail_url)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
      """,
      [video_id, title, channel_id, channel_title, thumb]
    )
  end

  # Known subs
  def get_known_sub_ids do
    {:ok, %{rows: rows}} = query("SELECT channel_id FROM known_subscriptions", [])
    MapSet.new(rows, fn [id] -> id end)
  end

  def insert_known_sub(channel_id, title, thumb) do
    query(
      """
      INSERT INTO known_subscriptions (channel_id, channel_title, thumbnail_url)
      VALUES ($1, $2, $3) ON CONFLICT (channel_id) DO UPDATE
        SET channel_title=EXCLUDED.channel_title, thumbnail_url=EXCLUDED.thumbnail_url
      """,
      [channel_id, title, thumb]
    )
  end

  def delete_known_sub(channel_id) do
    query("DELETE FROM known_subscriptions WHERE channel_id=$1", [channel_id])
  end

  # Events
  def insert_event(event_type, data) do
    query(
      """
      INSERT INTO events (event_type, video_id, channel_id, title, channel_title, thumbnail_url, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      """,
      [
        event_type,
        Map.get(data, :video_id) || Map.get(data, "video_id"),
        Map.get(data, :channel_id) || Map.get(data, "channel_id"),
        Map.get(data, :title) || Map.get(data, "title"),
        Map.get(data, :channel) || Map.get(data, :channel_title) || Map.get(data, "channel_title"),
        Map.get(data, :thumbnail) || Map.get(data, "thumbnail"),
        Jason.encode!(data)
      ]
    )
  end

  # Seeded markers (kept in `config` table for backwards compat)
  def seeded?(key) do
    case query("SELECT 1 FROM config WHERE key=$1", [key]) do
      {:ok, %{num_rows: n}} when n > 0 -> true
      _ -> false
    end
  end

  def mark_seeded!(key) do
    query("INSERT INTO config (key, value) VALUES ($1, 'true') ON CONFLICT DO NOTHING", [key])
  end

  defp query(sql, params), do: Postgrex.query(YoutubePoller.DB, sql, params)
end
