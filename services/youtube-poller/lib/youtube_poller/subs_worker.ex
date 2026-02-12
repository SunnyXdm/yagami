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

  # Backoff: 15 min → 30 min → 1 hr → 2 hr → 4 hr (max)
  @initial_backoff_ms 15 * 60 * 1_000
  @max_backoff_ms 4 * 60 * 60 * 1_000

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 8_000)
    {:ok, %{skip_alerted: false, backoff_ms: 0, quota_alerted: false}}
  end

  @impl true
  def handle_info(:poll, state) do
    {state, next_interval} = poll(state)
    Process.send_after(self(), :poll, next_interval)
    {:noreply, state}
  end

  defp poll(state) do
    interval = Application.get_env(:youtube_poller, :poll_interval_subs, 3_600_000)
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

        {state, interval}
      else
        new_ids = MapSet.difference(current_ids, known_ids)
        lost_ids = MapSet.difference(known_ids, current_ids)

        # Safety check: if we see a suspiciously large diff, it's likely
        # an API pagination issue. Threshold is proportional to the known
        # subscription count (3%, minimum 15) to handle large sub lists.
        known_count = map_size(known)
        threshold = max(15, div(known_count * 3, 100))
        total_changes = MapSet.size(new_ids) + MapSet.size(lost_ids)

        updated_state =
          if total_changes > threshold do
            Logger.warning("Large diff: #{MapSet.size(new_ids)} new, #{MapSet.size(lost_ids)} lost (threshold=#{threshold}) — re-fetching to confirm...")

            # Re-fetch subscriptions to confirm which changes are real
            # (API pagination can return different subsets between calls)
            case confirm_changes(token, known_ids, new_ids, lost_ids, subs) do
              {:confirmed, confirmed_new, confirmed_lost, all_subs2} ->
                process_changes(confirmed_new, confirmed_lost, all_subs2, known, state)

              :skip ->
                unless state.skip_alerted do
                  YoutubePoller.NatsClient.publish_debug(
                    "⚠️ Subscriptions: large diff detected (#{total_changes} changes, #{length(subs)} fetched vs #{known_count} known). Re-fetch showed inconsistency — skipping."
                  )
                end

                %{state | skip_alerted: true}
            end
          else
            process_changes(new_ids, lost_ids, subs, known, state)
          end

        # Success — reset backoff
        if updated_state.backoff_ms > 0 do
          Logger.info("Quota recovered — resuming normal subscription polling")
        end

        {%{updated_state | backoff_ms: 0, quota_alerted: false}, interval}
      end
    else
      {:error, :quota_exceeded} ->
        backoff = next_backoff(state.backoff_ms)
        backoff_min = div(backoff, 60_000)

        Logger.warning("Quota exceeded — subs backing off for #{backoff_min} minutes")

        unless state.quota_alerted do
          YoutubePoller.NatsClient.publish_debug(
            "⚠️ YouTube API quota exceeded. Subscription polling paused, backing off #{backoff_min} min. Quota resets at midnight Pacific Time."
          )
        end

        {%{state | backoff_ms: backoff, quota_alerted: true}, backoff}

      {:error, reason} ->
        Logger.error("Failed to poll subscriptions: #{inspect(reason)}")

        YoutubePoller.NatsClient.publish_debug(
          "⚠️ Subscriptions poll failed: #{inspect(reason)}"
        )

        {state, interval}
    end
  end

  # Re-fetch subscriptions and only keep changes that appear in BOTH fetches.
  # This filters out phantom diffs caused by API pagination inconsistency.
  defp confirm_changes(token, known_ids, new_ids, lost_ids, _subs) do
    case YoutubePoller.YoutubeApi.list_subscriptions(token) do
      {:ok, subs2} ->
        current_ids2 = MapSet.new(subs2, fn s -> s.channel_id end)
        new_ids2 = MapSet.difference(current_ids2, known_ids)
        lost_ids2 = MapSet.difference(known_ids, current_ids2)

        # Only trust changes that appear in BOTH fetches
        confirmed_new = MapSet.intersection(new_ids, new_ids2)
        confirmed_lost = MapSet.intersection(lost_ids, lost_ids2)
        total = MapSet.size(confirmed_new) + MapSet.size(confirmed_lost)

        Logger.info("Re-fetch: #{MapSet.size(new_ids2)} new, #{MapSet.size(lost_ids2)} lost — #{total} confirmed")

        if total == 0 do
          :skip
        else
          {:confirmed, confirmed_new, confirmed_lost, subs2}
        end

      {:error, reason} ->
        Logger.error("Re-fetch failed: #{inspect(reason)}")
        :skip
    end
  end

  defp process_changes(new_ids, lost_ids, subs, known, state) do
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

    # Diff was within bounds — reset the skip alert flag
    %{state | skip_alerted: false}
  end

  defp next_backoff(0), do: @initial_backoff_ms
  defp next_backoff(current), do: min(current * 2, @max_backoff_ms)
end
