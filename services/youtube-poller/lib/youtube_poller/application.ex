defmodule YoutubePoller.Application do
  @moduledoc "OTP supervision tree."
  use Application

  @impl true
  def start(_type, _args) do
    db_config = YoutubePoller.DB.config()

    children = [
      {Postgrex, db_config ++ [name: YoutubePoller.DB]},
      YoutubePoller.Settings,
      YoutubePoller.NatsClient,
      YoutubePoller.CookiesSync,
      YoutubePoller.Heartbeat,
      YoutubePoller.LikesWorker,
      YoutubePoller.HistoryWorker,
      YoutubePoller.SubsWorker
    ]

    # Install NATS log handler once supervision tree is up.
    spawn(fn ->
      Process.sleep(3_000)
      YoutubePoller.LogBackend.install()
    end)

    Supervisor.start_link(children, strategy: :one_for_one, name: YoutubePoller.Supervisor)
  end
end
