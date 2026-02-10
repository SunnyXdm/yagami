defmodule YoutubePoller.HealthCheck do
  @moduledoc """
  Runs once at startup to verify external dependencies are working,
  then publishes a status report to the Telegram admin via NATS.

  Checks: YouTube API (OAuth token + API call), yt-dlp binary, NATS connectivity.
  """
  use GenServer
  require Logger

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    # Run checks after a short delay so DB/NATS are ready
    Process.send_after(self(), :run_checks, 3_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:run_checks, state) do
    report = run_all_checks()
    publish_report(report)
    # This GenServer's job is done — stop it cleanly
    {:stop, :normal, state}
  end

  defp run_all_checks do
    Logger.info("Running startup health checks...")

    checks = [
      {"YouTube API", &check_youtube_api/0},
      {"yt-dlp", &check_ytdlp/0},
      {"Database", &check_db/0}
    ]

    results = Enum.map(checks, fn {name, func} ->
      case func.() do
        :ok ->
          Logger.info("  ✓ #{name}")
          {name, :ok, nil}

        {:ok, detail} ->
          Logger.info("  ✓ #{name}: #{detail}")
          {name, :ok, detail}

        {:error, reason} ->
          Logger.error("  ✗ #{name}: #{reason}")
          {name, :error, reason}
      end
    end)

    passed = Enum.count(results, fn {_, status, _} -> status == :ok end)
    total = length(results)
    Logger.info("Health checks: #{passed}/#{total} passed")

    results
  end

  defp check_youtube_api do
    with {:ok, token} <- YoutubePoller.OAuth.get_token() do
      # Quick API call — just fetch 1 liked video to verify access
      headers = [{"authorization", "Bearer #{token}"}]
      params = %{part: "id", myRating: "like", maxResults: 1}

      case Req.get("https://www.googleapis.com/youtube/v3/videos", params: params, headers: headers) do
        {:ok, %{status: 200}} -> {:ok, "authenticated"}
        {:ok, %{status: status}} -> {:error, "HTTP #{status}"}
        {:error, reason} -> {:error, inspect(reason)}
      end
    end
  end

  defp check_ytdlp do
    case System.cmd("yt-dlp", ["--version"], stderr_to_stdout: true) do
      {version, 0} -> {:ok, "v#{String.trim(version)}"}
      {_, _} -> {:error, "yt-dlp not found or failed"}
    end
  rescue
    e -> {:error, Exception.message(e)}
  end

  defp check_db do
    case Postgrex.query(YoutubePoller.DB, "SELECT 1", []) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp publish_report(results) do
    passed = Enum.count(results, fn {_, s, _} -> s == :ok end)
    total = length(results)
    icon = if passed == total, do: "✅", else: "⚠️"

    lines = Enum.map(results, fn
      {name, :ok, nil} -> "  ✓ #{name}"
      {name, :ok, detail} -> "  ✓ #{name} — #{detail}"
      {name, :error, reason} -> "  ✗ #{name} — #{reason}"
    end)

    message = """
    #{icon} Yagami started (#{passed}/#{total} checks passed)

    #{Enum.join(lines, "\n")}
    """

    YoutubePoller.NatsClient.publish("system.health", %{
      type: "startup_report",
      message: String.trim(message),
      passed: passed,
      total: total
    })
  rescue
    e ->
      Logger.error("Failed to publish health report: #{Exception.message(e)}")
  end
end
