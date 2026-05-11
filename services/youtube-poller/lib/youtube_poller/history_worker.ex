defmodule YoutubePoller.HistoryWorker do
  @moduledoc "Scrapes watch history via yt-dlp."
  use GenServer
  require Logger

  @seed_key "seeded_history"

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 10_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:poll, state) do
    poll()
    interval = YoutubePoller.Settings.get_int("poll.interval_history", 600) * 1000
    Process.send_after(self(), :poll, interval)
    {:noreply, state}
  end

  defp poll do
    Logger.info("Scraping watch history...")
    case YoutubePoller.Ytdlp.scrape_watch_history() do
      {:ok, videos} ->
        known = YoutubePoller.DB.get_known_watch_ids()
        new_videos = Enum.reject(videos, &MapSet.member?(known, &1.video_id))

        if not YoutubePoller.DB.seeded?(@seed_key) do
          Logger.info("Seeding #{length(new_videos)} watch history entries silently")
          for v <- new_videos, do: YoutubePoller.DB.insert_known_watch(v.video_id, v.title, v.channel_id, v.channel, v.thumbnail)
          YoutubePoller.DB.mark_seeded!(@seed_key)
        else
          Logger.info("Found #{length(new_videos)} new watched videos")
          for v <- new_videos do
            YoutubePoller.NatsClient.publish("youtube.watch", v)
            YoutubePoller.DB.insert_known_watch(v.video_id, v.title, v.channel_id, v.channel, v.thumbnail)
            YoutubePoller.DB.insert_event("watch", v)
          end
        end

      {:error, reason} ->
        Logger.error("Watch history scrape failed: #{inspect(reason)}")
    end
  end
end
