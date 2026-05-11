defmodule YoutubePoller.CookiesSync do
  @moduledoc """
  Writes the `youtube.cookies` setting (Netscape-format text) to the file
  yt-dlp expects. Refreshed every 60s in case the user pastes new cookies
  via the web UI.
  """
  use GenServer
  require Logger

  @interval 60_000

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @impl true
  def init(:ok) do
    Process.send_after(self(), :sync, 1_000)
    {:ok, %{hash: nil}}
  end

  @impl true
  def handle_info(:sync, state) do
    new_state = sync(state)
    Process.send_after(self(), :sync, @interval)
    {:noreply, new_state}
  end

  defp sync(state) do
    path = Application.get_env(:youtube_poller, :cookies_path, "/cookies/cookies.txt")
    content = YoutubePoller.Settings.get("youtube.cookies", "")
    hash = :erlang.phash2(content)

    cond do
      content == "" -> state
      hash == state.hash -> state
      true ->
        File.mkdir_p(Path.dirname(path))
        case File.write(path, content) do
          :ok ->
            Logger.info("Wrote cookies to #{path} (#{byte_size(content)} bytes)")
            %{state | hash: hash}
          {:error, reason} ->
            Logger.error("Failed to write cookies to #{path}: #{inspect(reason)}")
            state
        end
    end
  end
end
