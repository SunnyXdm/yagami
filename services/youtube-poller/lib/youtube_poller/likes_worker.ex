defmodule YoutubePoller.LikesWorker do
  @moduledoc """
  Polls YouTube liked videos and publishes new likes to NATS.

  LEARNING: This is a GenServer used as a periodic worker. The pattern is:
    1. init/1 sends the first :poll message to itself
    2. handle_info(:poll, state) does the work, then schedules the next :poll
    3. Process.send_after/3 is the timer — sends a message after N milliseconds

  This is idempotent: we diff the current likes against known_likes in the DB.
  Only NEW likes trigger events.
  """
  use GenServer
  require Logger

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  def init(:ok) do
    # Schedule first poll after 5 seconds (let other services start)
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

    # LEARNING: `with` chains multiple pattern matches. If any step fails
    # to match, it short-circuits to the else block. Great for multi-step ops.
    with {:ok, token} <- YoutubePoller.OAuth.get_token() do
      videos = YoutubePoller.YoutubeApi.list_liked_videos(token)
      known_ids = YoutubePoller.DB.get_known_like_ids()

      new_videos = Enum.reject(videos, fn v -> MapSet.member?(known_ids, v.video_id) end)

      Logger.info("Found #{length(new_videos)} new liked videos")

      for video <- new_videos do
        # Save to DB so we don't re-process next time
        YoutubePoller.DB.insert_known_like(video.video_id)
        YoutubePoller.DB.insert_event("like", video)

        # Publish to NATS for Telegram notification
        YoutubePoller.NatsClient.publish("youtube.likes", video)

        # Also request download
        YoutubePoller.NatsClient.publish("download.request", %{
          video_id: video.video_id,
          title: video.title,
          url: "https://www.youtube.com/watch?v=#{video.video_id}"
        })

        Logger.info("New like: #{video.title}")
      end
    else
      {:error, reason} ->
        Logger.error("Failed to poll likes: #{inspect(reason)}")
    end
  end
end
