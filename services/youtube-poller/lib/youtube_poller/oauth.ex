defmodule YoutubePoller.OAuth do
  @moduledoc """
  Google OAuth2 token management.

  Tokens are stored in the database. This module checks expiry and refreshes
  when needed. The initial token is obtained via scripts/oauth-setup.py.

  LEARNING: Pattern matching in function heads — Elixir picks the first
  function clause whose pattern matches the arguments. This replaces
  if/else chains and makes code very declarative.
  """
  require Logger

  @google_token_url "https://oauth2.googleapis.com/token"

  @doc "Get a valid access token, refreshing if expired."
  def get_token do
    # Try env var first (simpler), fall back to database
    case get_refresh_token() do
      {:ok, refresh_token} ->
        # With env-based refresh token, we always refresh on demand.
        # A process-level cache could be added later.
        refresh(refresh_token)

      {:error, :no_token} ->
        Logger.error("No OAuth token found. Set GOOGLE_REFRESH_TOKEN in .env or run scripts/oauth-setup.py")
        {:error, :no_token}
    end
  end

  defp get_refresh_token do
    case Application.get_env(:youtube_poller, :google_refresh_token) do
      token when is_binary(token) and token != "" ->
        {:ok, token}

      _ ->
        # Fall back to database
        case YoutubePoller.DB.get_oauth_token() do
          {:ok, _access, refresh, _expires} -> {:ok, refresh}
          error -> error
        end
    end
  end

  @doc "Exchange a refresh token for a new access token."
  def refresh(refresh_token) do
    client_id = Application.get_env(:youtube_poller, :google_client_id)
    client_secret = Application.get_env(:youtube_poller, :google_client_secret)

    body = %{
      client_id: client_id,
      client_secret: client_secret,
      refresh_token: refresh_token,
      grant_type: "refresh_token"
    }

    case Req.post(@google_token_url, form: body) do
      {:ok, %{status: 200, body: %{"access_token" => token, "expires_in" => expires_in}}} ->
        expires_at = DateTime.add(DateTime.utc_now(), expires_in, :second)
        YoutubePoller.DB.update_access_token(token, expires_at)
        Logger.info("Refreshed OAuth access token")
        {:ok, token}

      {:ok, %{status: status, body: body}} ->
        Logger.error("Token refresh failed: #{status} — #{inspect(body)}")
        {:error, :refresh_failed}

      {:error, reason} ->
        Logger.error("Token refresh request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
