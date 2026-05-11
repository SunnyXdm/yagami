defmodule YoutubePoller.NatsClient do
  @moduledoc "GenServer wrapping a Gnat NATS connection."
  use GenServer
  require Logger

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  def publish(subject, data) when is_binary(subject) do
    GenServer.call(__MODULE__, {:publish, subject, Jason.encode!(data)})
  end

  def publish_raw(subject, payload) when is_binary(subject) and is_binary(payload) do
    case Process.whereis(__MODULE__) do
      nil -> {:error, :not_started}
      _ -> GenServer.call(__MODULE__, {:publish, subject, payload}, 1000)
    end
  rescue
    _ -> :ok
  catch
    :exit, _ -> :ok
  end

  def publish_debug(message) when is_binary(message) do
    publish("system.health", %{type: "debug", message: message})
  end

  @impl true
  def init(:ok) do
    nats_url = System.get_env("NATS_URL", "nats://nats:4222")
    uri = URI.parse(nats_url)

    settings = %{host: uri.host || "nats", port: uri.port || 4222}

    case Gnat.start_link(settings) do
      {:ok, conn} ->
        Logger.info("Connected to NATS at #{settings.host}:#{settings.port}")
        # Subscribe to config-changed events to refresh ETS cache
        spawn(fn ->
          Process.sleep(2_000)
          try do
            Gnat.sub(conn, self(), "system.config_changed")
            loop_config_listener()
          rescue
            _ -> :ok
          end
        end)
        {:ok, %{conn: conn}}
      {:error, reason} ->
        Logger.error("NATS connect failed: #{inspect(reason)}")
        {:stop, reason}
    end
  end

  defp loop_config_listener do
    receive do
      {:msg, _} ->
        if Process.whereis(YoutubePoller.Settings), do: YoutubePoller.Settings.reload()
        loop_config_listener()
      _ ->
        loop_config_listener()
    end
  end

  @impl true
  def handle_call({:publish, subject, payload}, _from, %{conn: conn} = state) do
    {:reply, Gnat.pub(conn, subject, payload), state}
  end
end
