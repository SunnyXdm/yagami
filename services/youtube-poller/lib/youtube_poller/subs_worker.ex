defmodule YoutubePoller.SubsWorker do
  @moduledoc """
  Polls the user's YouTube subscriptions list and emits `youtube.subscribe` /
  `youtube.unsubscribe` events when the set changes.
  """
  use GenServer
  require Logger

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :poll, 15_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:poll, state) do
    poll()
    interval = YoutubePoller.Settings.get_int("poll.interval_subs", 3600) * 1000
    Process.send_after(self(), :poll, interval)
    {:noreply, state}
  end

  defp poll do
    Logger.info("Polling subscriptions...")
    seeded = YoutubePoller.DB.seeded?("seeded_subs")

    with {:ok, token} <- YoutubePoller.OAuth.get_token(),
         {:ok, subs} <- YoutubePoller.YoutubeApi.list_subscriptions(token) do
      known = YoutubePoller.DB.get_known_sub_ids()
      current = MapSet.new(subs, & &1.channel_id)
      new_subs = Enum.reject(subs, &MapSet.member?(known, &1.channel_id))
      removed = MapSet.difference(known, current) |> MapSet.to_list()

      cond do
        not seeded ->
          Logger.info("Seeding #{length(subs)} existing subscriptions silently")
          for s <- subs, do: YoutubePoller.DB.insert_known_sub(s.channel_id, s.channel_title, s.thumbnail)
          YoutubePoller.DB.mark_seeded!("seeded_subs")

        true ->
          for s <- new_subs do
            YoutubePoller.NatsClient.publish("youtube.subscribe", s)
            YoutubePoller.DB.insert_known_sub(s.channel_id, s.channel_title, s.thumbnail)
            YoutubePoller.DB.insert_event("subscribe", s)
            Logger.info("Subscribed: #{s.channel_title}")
          end

          for cid <- removed do
            YoutubePoller.NatsClient.publish("youtube.unsubscribe", %{channel_id: cid})
            YoutubePoller.DB.delete_known_sub(cid)
            YoutubePoller.DB.insert_event("unsubscribe", %{channel_id: cid})
            Logger.info("Unsubscribed: #{cid}")
          end
      end
    else
      {:error, reason} ->
        Logger.error("Subscriptions poll failed: #{inspect(reason)}")
    end
  end
end
