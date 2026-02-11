defmodule YoutubePoller.SubsWorker do
  @moduledoc """
  Polls YouTube subscriptions and publishes changes to NATS.

  On first run, seeds all current subscriptions silently. After that,
  detects new subscriptions and unsubscriptions via MapSet diffing.

  LEARNING: MapSet.difference(a, b) gives items in a but not b — perfect
  for detecting adds/removes between two snapshots.
  """
  use GenServer
  require Logger

  @seed_key "seeded_subs"

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

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

    with {:ok, token} <- YoutubePoller.OAuth.get_token(),
         {:ok, subs} <- YoutubePoller.YoutubeApi.list_subscriptions(token) do
      known = YoutubePoller.DB.get_known_subscriptions()
      current_ids = MapSet.new(subs, fn s -> s.channel_id end)
      known_ids = MapSet.new(Map.keys(known))

      # Detect stale data: if known subs have NULL titles, re-seed everything
      stale? = Enum.any?(Map.values(known), &is_nil/1)

      if not YoutubePoller.DB.seeded?(@seed_key) or stale? do
        Logger.info("Seeding #{MapSet.size(current_ids)} subscriptions (no notifications)")
        for sub <- subs, do: YoutubePoller.DB.insert_known_subscription(sub.channel_id, sub.channel_title)
        # Remove any known IDs that are no longer in YouTube (silently)
        for channel_id <- MapSet.difference(known_ids, current_ids) do
          YoutubePoller.DB.remove_known_subscription(channel_id)
        end
        YoutubePoller.DB.mark_seeded!(@seed_key)

        YoutubePoller.NatsClient.publish_debug(
          "📋 Subscriptions seeded: #{length(subs)} channels recorded silently"
        )
      else
        new_ids = MapSet.difference(current_ids, known_ids)
        lost_ids = MapSet.difference(known_ids, current_ids)

        # Safety check: if we see a suspiciously large diff (>10 changes at once),
        # it's likely an API pagination issue — skip this poll cycle.
        total_changes = MapSet.size(new_ids) + MapSet.size(lost_ids)

        if total_changes > 10 do
          Logger.warning("Suspicious diff: #{MapSet.size(new_ids)} new, #{MapSet.size(lost_ids)} lost — skipping (likely API pagination issue)")

          YoutubePoller.NatsClient.publish_debug(
            "⚠️ Subscriptions: skipped poll — #{total_changes} changes detected, likely API pagination issue (#{length(subs)} fetched vs #{map_size(known)} known)"
          )
        else
          # New subscriptions
          new_subs = Enum.filter(subs, fn s -> MapSet.member?(new_ids, s.channel_id) end)

          for sub <- new_subs do
            YoutubePoller.DB.insert_known_subscription(sub.channel_id, sub.channel_title)
            YoutubePoller.DB.insert_event("subscription", sub)
            YoutubePoller.NatsClient.publish("youtube.subscriptions", Map.put(sub, :action, "subscribed"))
            Logger.info("New subscription: #{sub.channel_title}")
          end

          # Lost subscriptions
          for channel_id <- lost_ids do
            channel_title = Map.get(known, channel_id) || "Unknown"
            YoutubePoller.DB.remove_known_subscription(channel_id)
            YoutubePoller.DB.insert_event("unsubscription", %{channel_id: channel_id, channel_title: channel_title})
            YoutubePoller.NatsClient.publish("youtube.subscriptions", %{channel_id: channel_id, channel_title: channel_title, action: "unsubscribed"})
            Logger.info("Unsubscribed from: #{channel_title}")
          end

          Logger.info("Subs check: #{length(new_subs)} new, #{MapSet.size(lost_ids)} removed")
        end
      end
    else
      {:error, reason} ->
        Logger.error("Failed to poll subscriptions: #{inspect(reason)}")

        YoutubePoller.NatsClient.publish_debug(
          "⚠️ Subscriptions poll failed: #{inspect(reason)}"
        )
    end
  end
end
