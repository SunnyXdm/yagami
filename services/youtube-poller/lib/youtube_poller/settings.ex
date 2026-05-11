defmodule YoutubePoller.Settings do
  @moduledoc """
  In-memory cache of the `settings` table, refreshed every 30s and on
  `system.config_changed` NATS events. Single source of truth for
  every runtime knob (intervals, secrets, chat IDs, cookies content).
  """
  use GenServer
  require Logger

  @refresh_ms 30_000
  @table :yagami_settings

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @doc "Look up a setting; returns the raw string value, or `default` if missing/empty."
  def get(key, default \\ nil) when is_binary(key) do
    case :ets.lookup(@table, key) do
      [{^key, ""}] -> default
      [{^key, v}] -> v
      _ -> default
    end
  end

  @doc "Look up an integer setting (with sane fallback)."
  def get_int(key, default) do
    case get(key) do
      nil -> default
      v ->
        case Integer.parse(v) do
          {n, _} -> n
          _ -> default
        end
    end
  end

  def reload, do: GenServer.cast(__MODULE__, :reload)

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :public, read_concurrency: true])
    send(self(), :load)
    Process.send_after(self(), :refresh, @refresh_ms)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:load, state) do
    load!()
    {:noreply, state}
  end

  def handle_info(:refresh, state) do
    load!()
    Process.send_after(self(), :refresh, @refresh_ms)
    {:noreply, state}
  end

  @impl true
  def handle_cast(:reload, state) do
    load!()
    {:noreply, state}
  end

  defp load! do
    case Postgrex.query(YoutubePoller.DB, "SELECT key, COALESCE(value,'') FROM settings", []) do
      {:ok, %{rows: rows}} ->
        for [k, v] <- rows, do: :ets.insert(@table, {k, v})
        :ok
      {:error, reason} ->
        Logger.warning("Settings load failed: #{inspect(reason)}")
        :error
    end
  end
end
