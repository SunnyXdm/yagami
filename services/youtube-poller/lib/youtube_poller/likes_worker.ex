defmodule YoutubePoller.LikesWorker do
  @moduledoc "Polls liked videos, emits new likes + download requests."
  use GenServer
  require Logger

  @seed_key "seeded_likes"
  @initial_backoff_ms 15 * 60 * 1_000
  @max_backoff_ms 4 * 60 * 60 * 1_000

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 5_000)
    {:ok, %{backoff_ms: 0, quota_alerted: false}}
  end

  @impl true
  def handle_info(:poll, state) do
    {state, next} = poll(state)
    Process.send_after(self(), :poll, next)
    {:noreply, state}
  end

  defp poll(state) do
    interval = YoutubePoller.Settings.get_int("poll.interval_likes", 300) * 1000
    Logger.info("Polling liked videos...")

    with {:ok, token} <- YoutubePoller.OAuth.get_token(),
         {:ok, videos} <- YoutubePoller.YoutubeApi.list_liked_videos(token) do
      known = YoutubePoller.DB.get_known_like_ids()
      new_videos = Enum.reject(videos, &MapSet.member?(known, &1.video_id))

      if not YoutubePoller.DB.seeded?(@seed_key) do
        Logger.info("Seeding #{length(new_videos)} liked videos silently")
        for v <- new_videos, do: YoutubePoller.DB.insert_known_like(v.video_id, v.title, v.channel_id, v.channel, v.thumbnail)
        YoutubePoller.DB.mark_seeded!(@seed_key)
      else
        Logger.info("Found #{length(new_videos)} new liked videos")
        for v <- new_videos do
          YoutubePoller.NatsClient.publish("youtube.likes", v)
          YoutubePoller.DB.insert_known_like(v.video_id, v.title, v.channel_id, v.channel, v.thumbnail)
          YoutubePoller.DB.insert_event("like", v)

          YoutubePoller.NatsClient.publish("download.request", %{
            video_id: v.video_id, title: v.title, channel: v.channel,
            channel_id: v.channel_id, duration: v.duration, thumbnail: v.thumbnail,
            url: "https://www.youtube.com/watch?v=#{v.video_id}"
          })
          Logger.info("New like: #{v.title}")
        end
      end

      {%{state | backoff_ms: 0, quota_alerted: false}, interval}
    else
      {:error, :quota_exceeded} ->
        backoff = next_backoff(state.backoff_ms)
        Logger.warning("Quota exceeded — backoff #{div(backoff, 60_000)}m")
        unless state.quota_alerted do
          YoutubePoller.NatsClient.publish_debug("⚠️ YouTube quota exceeded — backing off #{div(backoff, 60_000)} min")
        end
        {%{state | backoff_ms: backoff, quota_alerted: true}, backoff}

      {:error, reason} ->
        Logger.error("Likes poll failed: #{inspect(reason)}")
        {state, interval}
    end
  end

  defp next_backoff(0), do: @initial_backoff_ms
  defp next_backoff(c), do: min(c * 2, @max_backoff_ms)
end
