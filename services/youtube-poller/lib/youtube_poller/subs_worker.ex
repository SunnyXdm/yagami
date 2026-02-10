defmodule YoutubePoller.SubsWorker do
  @moduledoc """
  Polls YouTube subscriptions and publishes changes to NATS.

  Unlike LikesWorker, this also detects UNsubscriptions by comparing
  current subs against known subs. If a known sub disappears, we emit
  an "unsubscription" event.

  LEARNING: MapSet operations make diffing easy:
    - MapSet.difference(a, b) → items in a but not in b
    - new_subs  = current_ids - known_ids  (added)
    - lost_subs = known_ids - current_ids  (removed)
  """
  use GenServer
  require Logger

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 8_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:poll, state) do
    poll()
    interval = Application.get_env(:youtube_poller, :poll_interval_subs, 3_600_000)
    Process.send_after(self(), :poll, interval)
    {:noreply, state}
  end

  defp poll do
    Logger.info("Polling subscriptions...")

    with {:ok, token} <- YoutubePoller.OAuth.get_token() do
      subs = YoutubePoller.YoutubeApi.list_subscriptions(token)
      known_ids = YoutubePoller.DB.get_known_subscription_ids()

      current_ids = MapSet.new(subs, fn s -> s.channel_id end)

      # New subscriptions
      new_ids = MapSet.difference(current_ids, known_ids)
      new_subs = Enum.filter(subs, fn s -> MapSet.member?(new_ids, s.channel_id) end)

      for sub <- new_subs do
        YoutubePoller.DB.insert_known_subscription(sub.channel_id)
        YoutubePoller.DB.insert_event("subscription", sub)
        YoutubePoller.NatsClient.publish("youtube.subscriptions", Map.put(sub, :action, "subscribed"))
        Logger.info("New subscription: #{sub.channel_title}")
      end

      # Lost subscriptions (unsubscribed)
      lost_ids = MapSet.difference(known_ids, current_ids)

      for channel_id <- lost_ids do
        YoutubePoller.DB.remove_known_subscription(channel_id)

        YoutubePoller.DB.insert_event("unsubscription", %{channel_id: channel_id})

        YoutubePoller.NatsClient.publish("youtube.subscriptions", %{
          channel_id: channel_id,
          action: "unsubscribed"
        })

        Logger.info("Unsubscribed from: #{channel_id}")
      end

      Logger.info("Subs check: #{length(new_subs)} new, #{MapSet.size(lost_ids)} removed")
    else
      {:error, reason} ->
        Logger.error("Failed to poll subscriptions: #{inspect(reason)}")
    end
  end
end
