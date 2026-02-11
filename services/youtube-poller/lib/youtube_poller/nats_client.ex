defmodule YoutubePoller.NatsClient do
  @moduledoc """
  GenServer that holds a NATS connection and exposes a publish/2 function.

  LEARNING: GenServer is the workhorse of OTP. It's a process that holds state
  and responds to messages. The pattern is:
    1. init/1       — set up initial state
    2. handle_call  — synchronous request/response
    3. handle_cast  — async fire-and-forget
    4. handle_info  — messages from outside GenServer protocol
  """
  use GenServer
  require Logger

  # --- Public API ---

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc "Publish a JSON message to a NATS subject."
  def publish(subject, data) when is_binary(subject) do
    GenServer.call(__MODULE__, {:publish, subject, Jason.encode!(data)})
  end

  @doc "Send a debug/error message to the admin via NATS."
  def publish_debug(message) when is_binary(message) do
    publish("system.health", %{type: "debug", message: message})
  end

  # --- GenServer callbacks ---

  @impl true
  def init(:ok) do
    nats_url = Application.get_env(:youtube_poller, :nats_url, "nats://localhost:4222")
    uri = URI.parse(nats_url)

    connection_settings = %{
      host: uri.host || "localhost",
      port: uri.port || 4222
    }

    case Gnat.start_link(connection_settings) do
      {:ok, conn} ->
        Logger.info("Connected to NATS at #{uri.host}:#{uri.port}")
        {:ok, %{conn: conn}}

      {:error, reason} ->
        Logger.error("Failed to connect to NATS: #{inspect(reason)}")
        # LEARNING: Returning {:stop, reason} from init/1 tells the supervisor
        # this process failed to start and should be restarted.
        {:stop, reason}
    end
  end

  @impl true
  def handle_call({:publish, subject, payload}, _from, %{conn: conn} = state) do
    result = Gnat.pub(conn, subject, payload)
    {:reply, result, state}
  end
end
