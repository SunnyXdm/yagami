defmodule YoutubePoller.Application do
  @moduledoc """
  OTP Application — starts the supervision tree.

  LEARNING: An OTP Application is the entry point. The supervisor watches
  all child processes and restarts them if they crash (let it crash philosophy).
  Children start in order, so DB must come before workers that use it.
  """
  use Application

  @impl true
  def start(_type, _args) do
    db_config = YoutubePoller.DB.config()

    children = [
      # 1. Database connection (must start first — workers depend on it)
      {Postgrex, db_config ++ [name: YoutubePoller.DB]},

      # 2. NATS connection (workers publish through this)
      YoutubePoller.NatsClient,

      # 3. Polling workers (start after DB + NATS are ready)
      YoutubePoller.LikesWorker,
      YoutubePoller.SubsWorker,
      YoutubePoller.HistoryWorker
    ]

    # LEARNING: :one_for_one means if one child crashes, only that child restarts.
    # Other strategies: :one_for_all (restart all), :rest_for_one (restart crashed + later ones).
    opts = [strategy: :one_for_one, name: YoutubePoller.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
