defmodule YoutubePoller.HistoryWorker do
  @moduledoc """
  Scrapes YouTube watch history via yt-dlp and publishes new watches to NATS.

  This uses yt-dlp (not the YouTube API) because watch history is NOT
  available through the API. Requires browser cookies for authentication.

  LEARNING: This follows the same GenServer timer pattern as LikesWorker,
  but uses System.cmd (via Ytdlp module) instead of HTTP requests.
  """
  use GenServer
  require Logger

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 10_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:poll, state) do
    poll()
    interval = Application.get_env(:youtube_poller, :poll_interval_history, 600_000)
    Process.send_after(self(), :poll, interval)
    {:noreply, state}
  end

  defp poll do
    Logger.info("Scraping watch history...")

    case YoutubePoller.Ytdlp.scrape_watch_history() do
      {:ok, videos} ->
        known_ids = YoutubePoller.DB.get_known_watch_ids()

        new_videos = Enum.reject(videos, fn v -> MapSet.member?(known_ids, v.video_id) end)

        Logger.info("Found #{length(new_videos)} new watched videos")

        for video <- new_videos do
          YoutubePoller.DB.insert_known_watch(video.video_id)
          YoutubePoller.DB.insert_event("watch", video)
          YoutubePoller.NatsClient.publish("youtube.watch", video)
          Logger.info("New watch: #{video.title}")
        end

      {:error, reason} ->
        Logger.error("Watch history scrape failed: #{inspect(reason)}")
    end
  end
end
