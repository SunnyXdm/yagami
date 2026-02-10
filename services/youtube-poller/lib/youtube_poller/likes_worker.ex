defmodule YoutubePoller.LikesWorker do
  @moduledoc """
  Polls YouTube liked videos and publishes new likes to NATS.

  On first run, seeds the database with all current likes without
  sending notifications or triggering downloads. Only truly new likes
  (detected after seeding) are published.

  LEARNING: GenServer periodic worker pattern — init schedules the first
  :poll via Process.send_after, then each handle_info reschedules the next.
  """
  use GenServer
  require Logger

  @seed_key "seeded_likes"

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 5_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:poll, state) do
    poll()
    interval = Application.get_env(:youtube_poller, :poll_interval_likes, 300_000)
    Process.send_after(self(), :poll, interval)
    {:noreply, state}
  end

  defp poll do
    Logger.info("Polling liked videos...")

    with {:ok, token} <- YoutubePoller.OAuth.get_token() do
      videos = YoutubePoller.YoutubeApi.list_liked_videos(token)
      known_ids = YoutubePoller.DB.get_known_like_ids()
      new_videos = Enum.reject(videos, fn v -> MapSet.member?(known_ids, v.video_id) end)

      if not YoutubePoller.DB.seeded?(@seed_key) do
        # First run — record everything silently, no notifications
        Logger.info("Seeding #{length(new_videos)} existing liked videos (no notifications)")
        for video <- new_videos, do: YoutubePoller.DB.insert_known_like(video.video_id)
        YoutubePoller.DB.mark_seeded!(@seed_key)
      else
        Logger.info("Found #{length(new_videos)} new liked videos")

        for video <- new_videos do
          YoutubePoller.DB.insert_known_like(video.video_id)
          YoutubePoller.DB.insert_event("like", video)
          YoutubePoller.NatsClient.publish("youtube.likes", video)

          # Request download — include metadata so downstream has everything
          YoutubePoller.NatsClient.publish("download.request", %{
            video_id: video.video_id,
            title: video.title,
            channel: video.channel,
            channel_id: video.channel_id,
            duration: video.duration,
            thumbnail: video.thumbnail,
            url: "https://www.youtube.com/watch?v=#{video.video_id}"
          })

          Logger.info("New like: #{video.title}")
        end
      end
    else
      {:error, reason} -> Logger.error("Failed to poll likes: #{inspect(reason)}")
    end
  end
end
