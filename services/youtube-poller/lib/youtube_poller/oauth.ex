defmodule YoutubePoller.OAuth do
  @moduledoc """
  Google OAuth2 token management — DB only.

  When Google rejects the refresh (`invalid_grant`, typical after the 7-day
  Testing-mode expiry), we mark the auth as broken in `settings.google.auth_status`
  so the web UI can prompt the user to re-authorize. Error bodies are logged.
  """
  require Logger

  @google_token_url "https://oauth2.googleapis.com/token"

  def get_token do
    case YoutubePoller.DB.get_oauth_token() do
      {:ok, access, _refresh, expires_at} when is_binary(access) and not is_nil(expires_at) ->
        if token_valid?(expires_at), do: {:ok, access}, else: do_refresh()
      _ ->
        do_refresh()
    end
  end

  def token_valid?(nil), do: false
  def token_valid?(expires_at) do
    buffer = DateTime.add(DateTime.utc_now(), 300, :second)
    DateTime.compare(expires_at, buffer) == :gt
  end

  defp do_refresh do
    case refresh_token_value() do
      {:ok, rt} -> refresh(rt)
      {:error, :no_token} ->
        YoutubePoller.DB.set_setting("google.auth_status", "missing")
        Logger.error("No Google refresh token. Authorize via the web UI.")
        {:error, :no_token}
    end
  end

  defp refresh_token_value do
    case YoutubePoller.DB.get_oauth_token() do
      {:ok, _a, refresh, _e} when is_binary(refresh) and refresh != "" -> {:ok, refresh}
      _ ->
        case YoutubePoller.Settings.get("google.refresh_token") do
          v when is_binary(v) and v != "" -> {:ok, v}
          _ -> {:error, :no_token}
        end
    end
  end

  def refresh(refresh_token) do
    cid = YoutubePoller.Settings.get("google.client_id")
    cs  = YoutubePoller.Settings.get("google.client_secret")

    cond do
      is_nil(cid) or cid == "" -> {:error, :no_client_id}
      is_nil(cs)  or cs  == "" -> {:error, :no_client_secret}
      true -> do_refresh_request(cid, cs, refresh_token)
    end
  end

  defp do_refresh_request(cid, cs, rt) do
    body = %{client_id: cid, client_secret: cs, refresh_token: rt, grant_type: "refresh_token"}

    case Req.post(@google_token_url, form: body) do
      {:ok, %{status: 200, body: %{"access_token" => token, "expires_in" => expires_in} = resp}} ->
        expires_at = DateTime.add(DateTime.utc_now(), expires_in, :second)
        new_rt = Map.get(resp, "refresh_token", rt)
        YoutubePoller.DB.upsert_oauth_token("google", token, new_rt, expires_at)
        if new_rt != rt, do: YoutubePoller.DB.set_setting("google.refresh_token", new_rt)
        YoutubePoller.DB.set_setting("google.auth_status", "ok")
        Logger.info("Refreshed Google access token (expires in #{expires_in}s)")
        {:ok, token}

      {:ok, %{status: 400, body: %{"error" => "invalid_grant"} = body}} ->
        Logger.error("Google rejected refresh token (invalid_grant): #{inspect(body)}")
        YoutubePoller.DB.set_setting("google.auth_status", "invalid_grant")
        YoutubePoller.NatsClient.publish_debug(
          "❌ Google refresh failed: invalid_grant. Open the web UI → Settings → Google → Re-authorize."
        )
        {:error, :invalid_grant}

      {:ok, %{status: status, body: body}} ->
        Logger.error("Google refresh failed HTTP #{status}: #{inspect(body)}")
        YoutubePoller.DB.set_setting("google.auth_status", "error_#{status}")
        {:error, {:http, status, body}}

      {:error, reason} ->
        Logger.error("Google refresh transport error: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
