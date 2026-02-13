defmodule YoutubePoller do
  @moduledoc """
  YouTube Poller — monitors your YouTube activity (likes, watch history)
  and publishes changes to NATS for downstream processing.

  Architecture:
    Application (supervisor)
    ├── Postgrex (named: YoutubePoller.DB)
    ├── NatsClient (GenServer wrapping Gnat)
    ├── LikesWorker (polls liked videos)
    └── HistoryWorker (scrapes watch history via yt-dlp)
  """
end
