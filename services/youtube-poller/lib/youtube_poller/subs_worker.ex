defmodule YoutubePoller.SubsWorker do
  @moduledoc """
  Polls the user's YouTube subscriptions list and emits `youtube.subscribe` /
  `youtube.unsubscribe` events when the set changes.
  """
  use GenServer
  require Logger

  @subscriptions_api_soft_cap 1000
  @unsubscribe_confirmations 2

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 15_000)
    {:ok, %{pending_unsubscribes: %{}, snapshot_warning_sent: false}}
  end

  @impl true
  def handle_info(:poll, state) do
    state = poll(state)
    interval = YoutubePoller.Settings.get_int("poll.interval_subs", 3600) * 1000
    Process.send_after(self(), :poll, interval)
    {:noreply, state}
  end

  defp poll(state) do
    Logger.info("Polling subscriptions...")
    seeded = YoutubePoller.DB.seeded?("seeded_subs")

    with {:ok, token} <- YoutubePoller.OAuth.get_token(),
         {:ok, subs} <- YoutubePoller.YoutubeApi.list_subscriptions(token) do
      known = YoutubePoller.DB.get_known_subscriptions()
      known_ids = Map.keys(known) |> MapSet.new()
      current = MapSet.new(subs, & &1.channel_id)
      case subscription_snapshot_issue(subs, current, known_ids) do
        nil ->
          state = maybe_clear_snapshot_warning(state)
          new_subs = Enum.reject(subs, &MapSet.member?(known_ids, &1.channel_id))
          removed = MapSet.difference(known_ids, current) |> MapSet.to_list()

          cond do
            not seeded ->
              Logger.info("Seeding #{length(subs)} existing subscriptions silently")
              for s <- subs, do: YoutubePoller.DB.insert_known_sub(s.channel_id, s.channel_title, s.thumbnail)
              YoutubePoller.DB.mark_seeded!("seeded_subs")
              %{state | pending_unsubscribes: %{}}

            true ->
              for s <- new_subs do
                YoutubePoller.NatsClient.publish("youtube.subscribe", s)
                YoutubePoller.DB.insert_known_sub(s.channel_id, s.channel_title, s.thumbnail)
                YoutubePoller.DB.insert_event("subscribe", s)
                Logger.info("Subscribed: #{s.channel_title}")
              end

              {confirmed_removed, pending_unsubscribes} = confirm_removed(removed, state.pending_unsubscribes)

              for cid <- confirmed_removed do
                sub = Map.get(known, cid, %{channel_id: cid})
                YoutubePoller.NatsClient.publish("youtube.unsubscribe", sub)
                YoutubePoller.DB.delete_known_sub(cid)
                YoutubePoller.DB.insert_event("unsubscribe", sub)
                Logger.info("Unsubscribed: #{sub.channel_title || cid}")
              end

              %{state | pending_unsubscribes: pending_unsubscribes}
          end

        reason ->
          warn_unstable_snapshot(reason, length(subs), MapSet.size(current), MapSet.size(known_ids), state.snapshot_warning_sent)
          %{state | pending_unsubscribes: %{}, snapshot_warning_sent: true}
      end
    else
      {:error, reason} ->
        Logger.error("Subscriptions poll failed: #{inspect(reason)}")
        state
    end
  end

  defp subscription_snapshot_issue(subs, current, known_ids) do
    raw_count = length(subs)
    unique_count = MapSet.size(current)
    known_count = MapSet.size(known_ids)

    cond do
      raw_count != unique_count ->
        "YouTube subscriptions.list returned duplicate channel IDs across pages"

      raw_count >= @subscriptions_api_soft_cap and known_count > unique_count ->
        "YouTube subscriptions.list appears capped before the full subscription set"

      raw_count >= @subscriptions_api_soft_cap ->
        "YouTube subscriptions.list reached the 1000-item safety cap, so the snapshot may be incomplete"

      true ->
        nil
    end
  end

  defp warn_unstable_snapshot(reason, raw_count, unique_count, known_count, already_warned?) do
    message =
      "Skipping subscriptions diff because the upstream snapshot is not trustworthy: #{reason}. " <>
        "received=#{raw_count}, unique=#{unique_count}, known=#{known_count}"

    Logger.warning(message)

    unless already_warned? do
      YoutubePoller.NatsClient.publish_debug(
        "⚠️ Subscription monitoring is paused because YouTube returned an incomplete or duplicate-filled subscriptions snapshot. " <>
          "This commonly happens on large accounts near the 1000-subscription API ceiling."
      )
    end
  end

  defp maybe_clear_snapshot_warning(%{snapshot_warning_sent: true} = state) do
    Logger.info("Subscription snapshot looks stable again; resuming diff processing")
    %{state | snapshot_warning_sent: false}
  end

  defp maybe_clear_snapshot_warning(state), do: state

  defp confirm_removed(removed, pending_unsubscribes) do
    Enum.reduce(removed, {[], %{}}, fn cid, {confirmed, pending} ->
      count = Map.get(pending_unsubscribes, cid, 0) + 1

      if count >= @unsubscribe_confirmations do
        {[cid | confirmed], pending}
      else
        {confirmed, Map.put(pending, cid, count)}
      end
    end)
  end
end
