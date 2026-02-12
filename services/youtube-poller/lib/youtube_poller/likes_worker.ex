defmodule YoutubePoller.LikesWorker do
  @moduledoc """
  Polls YouTube liked videos and publishes new likes to NATS.

  On first run, seeds the database with all current likes without
  sending notifications or triggering downloads. Only truly new likes
  (detected after seeding) are published.

  Includes exponential backoff when the YouTube API quota is exceeded.
  Backoff starts at 15 minutes and doubles up to 4 hours max.

  LEARNING: GenServer periodic worker pattern — init schedules the first
  :poll via Process.send_after, then each handle_info reschedules the next.
  """
  use GenServer
  require Logger

  @seed_key "seeded_likes"

  # Backoff: 15 min → 30 min → 1 hr → 2 hr → 4 hr (max)
  @initial_backoff_ms 15 * 60 * 1_000
  @max_backoff_ms 4 * 60 * 60 * 1_000

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 5_000)
    {:ok, %{backoff_ms: 0, quota_alerted: false}}
  end

  @impl true
  def handle_info(:poll, state) do
    {state, next_interval} = poll(state)
    Process.send_after(self(), :poll, next_interval)
    {:noreply, state}
  end

  defp poll(state) do
    interval = Application.get_env(:youtube_poller, :poll_interval_likes, 300_000)
    Logger.info("Polling liked videos...")

    with {:ok, token} <- YoutubePoller.OAuth.get_token(),
         {:ok, videos} <- YoutubePoller.YoutubeApi.list_liked_videos(token) do
      known_ids = YoutubePoller.DB.get_known_like_ids()
      new_videos = Enum.reject(videos, fn v -> MapSet.member?(known_ids, v.video_id) end)

      if not YoutubePoller.DB.seeded?(@seed_key) do
        # First run — record everything silently, no notifications
        Logger.info("Seeding #{length(new_videos)} existing liked videos (no notifications)")
        for video <- new_videos, do: YoutubePoller.DB.insert_known_like(video.video_id)
        YoutubePoller.DB.mark_seeded!(@seed_key)

        YoutubePoller.NatsClient.publish_debug(
          "📋 Likes seeded: #{length(new_videos)} videos recorded silently"
        )
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

      # Success — reset backoff
      if state.backoff_ms > 0 do
        Logger.info("Quota recovered — resuming normal polling")
      end

      {%{state | backoff_ms: 0, quota_alerted: false}, interval}
    else
      {:error, :quota_exceeded} ->
        backoff = next_backoff(state.backoff_ms)
        backoff_min = div(backoff, 60_000)

        Logger.warning("Quota exceeded — backing off for #{backoff_min} minutes")

        unless state.quota_alerted do
          YoutubePoller.NatsClient.publish_debug(
            "⚠️ YouTube API quota exceeded. Likes polling paused, backing off #{backoff_min} min. Quota resets at midnight Pacific Time."
          )
        end

        {%{state | backoff_ms: backoff, quota_alerted: true}, backoff}

      {:error, reason} ->
        Logger.error("Failed to poll likes: #{inspect(reason)}")

        YoutubePoller.NatsClient.publish_debug(
          "⚠️ Likes poll failed: #{inspect(reason)}"
        )

        {state, interval}
    end
  end

  defp next_backoff(0), do: @initial_backoff_ms
  defp next_backoff(current), do: min(current * 2, @max_backoff_ms)
end
