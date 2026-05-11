defmodule YoutubePoller.SubsWorker do
  @moduledoc """
  Polls the user's YouTube subscriptions list and emits `youtube.subscribe` /
  `youtube.unsubscribe` events when the set changes.
  """
  use GenServer
  require Logger

  @unsubscribe_confirmations 2

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 15_000)
    {:ok, %{pending_unsubscribes: %{}}}
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
    else
      {:error, reason} ->
        Logger.error("Subscriptions poll failed: #{inspect(reason)}")
        state
    end
  end

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
