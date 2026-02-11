defmodule YoutubePoller.HistoryWorker do
  @moduledoc """
  Scrapes YouTube watch history via yt-dlp and publishes new watches to NATS.

  Uses yt-dlp (not the API) because watch history isn't available via the
  YouTube Data API. Requires browser cookies for authentication.

  On first run, seeds all currently-visible watch history silently.
  """
  use GenServer
  require Logger

  @seed_key "seeded_history"

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

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
        Logger.info("yt-dlp returned #{length(videos)} videos from history")
        known_ids = YoutubePoller.DB.get_known_watch_ids()
        new_videos = Enum.reject(videos, fn v -> MapSet.member?(known_ids, v.video_id) end)

        if not YoutubePoller.DB.seeded?(@seed_key) do
          Logger.info("Seeding #{length(new_videos)} existing watch history entries (no notifications)")
          for video <- new_videos, do: YoutubePoller.DB.insert_known_watch(video.video_id)
          YoutubePoller.DB.mark_seeded!(@seed_key)

          YoutubePoller.NatsClient.publish_debug(
            "📺 Watch history seeded: #{length(new_videos)} videos recorded silently"
          )
        else
          Logger.info("Found #{length(new_videos)} new watched videos")

          for video <- new_videos do
            YoutubePoller.DB.insert_known_watch(video.video_id)
            YoutubePoller.DB.insert_event("watch", video)
            YoutubePoller.NatsClient.publish("youtube.watch", video)
            Logger.info("New watch: #{video.title}")
          end
        end

      {:error, reason} ->
        Logger.error("Watch history scrape failed: #{inspect(reason)}")

        YoutubePoller.NatsClient.publish_debug(
          "⚠️ Watch history scrape failed: #{inspect(reason)}"
        )
    end
  end
end
