defmodule YoutubePoller.Heartbeat do
  @moduledoc """
  Publishes a heartbeat to `system.heartbeat` every 30s so the gateway
  can show this service as alive in the dashboard.
  """
  use GenServer
  require Logger

  @interval 30_000
  @service "youtube-poller"

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :tick, 5_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    status = compute_status()
    payload = Jason.encode!(%{
      service: @service,
      status: status,
      version: "1.0.0",
      ts: DateTime.utc_now() |> DateTime.to_iso8601()
    })
    YoutubePoller.NatsClient.publish_raw("system.heartbeat", payload)
    Process.send_after(self(), :tick, @interval)
    {:noreply, state}
  end

  # "ok"        — fully operational
  # "degraded"  — running but auth is broken or refresh token missing
  defp compute_status do
    auth = YoutubePoller.Settings.get("google.auth_status", "")
    refresh = YoutubePoller.Settings.get("google.refresh_token", "")
    cond do
      refresh == "" -> "degraded"
      auth == "invalid_grant" -> "degraded"
      true -> "ok"
    end
  rescue
    _ -> "ok"
  end
end
