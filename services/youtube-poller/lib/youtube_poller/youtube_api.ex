defmodule YoutubePoller.YoutubeApi do
  @moduledoc """
  YouTube Data API v3 client — fetches liked videos and subscriptions.

  LEARNING: Elixir's |> (pipe) operator chains function calls left-to-right.
  Instead of: Enum.map(Enum.filter(list, &f/1), &g/1)
  You write:  list |> Enum.filter(&f/1) |> Enum.map(&g/1)
  Much more readable!
  """
  require Logger

  @base_url "https://www.googleapis.com/youtube/v3"

  @doc "Fetch all liked videos (auto-paginates)."
  def list_liked_videos(token) do
    fetch_all_pages("#{@base_url}/videos", %{
      part: "snippet,contentDetails",
      myRating: "like",
      maxResults: 50
    }, token)
    |> Enum.map(&parse_video/1)
  end

  @doc "Fetch all subscriptions (auto-paginates)."
  def list_subscriptions(token) do
    fetch_all_pages("#{@base_url}/subscriptions", %{
      part: "snippet",
      mine: true,
      maxResults: 50
    }, token)
    |> Enum.map(&parse_subscription/1)
  end

  # --- Private helpers ---

  # LEARNING: Recursive function with accumulator pattern.
  # Each call fetches one page and passes the nextPageToken to the next call.
  # When there's no next page, we return the accumulated items.
  defp fetch_all_pages(url, params, token, page_token \\ nil, acc \\ []) do
    params =
      if page_token do
        Map.put(params, :pageToken, page_token)
      else
        params
      end

    headers = [{"authorization", "Bearer #{token}"}]

    case Req.get(url, params: params, headers: headers) do
      {:ok, %{status: 200, body: body}} ->
        items = Map.get(body, "items", [])
        next = Map.get(body, "nextPageToken")
        all = acc ++ items

        if next do
          fetch_all_pages(url, params, token, next, all)
        else
          all
        end

      {:ok, %{status: status, body: body}} ->
        Logger.error("YouTube API error: #{status} — #{inspect(body)}")
        acc

      {:error, reason} ->
        Logger.error("YouTube API request failed: #{inspect(reason)}")
        acc
    end
  end

  defp parse_video(item) do
    snippet = item["snippet"]
    content = item["contentDetails"]

    %{
      video_id: item["id"],
      title: snippet["title"],
      channel: snippet["channelTitle"],
      channel_id: snippet["channelId"],
      thumbnail: get_in(snippet, ["thumbnails", "high", "url"]),
      duration: parse_duration(content["duration"]),
      published_at: snippet["publishedAt"]
    }
  end

  defp parse_subscription(item) do
    snippet = item["snippet"]
    resource = snippet["resourceId"]

    %{
      channel_id: resource["channelId"],
      channel_title: snippet["title"],
      thumbnail: get_in(snippet, ["thumbnails", "high", "url"]),
      subscribed_at: snippet["publishedAt"]
    }
  end

  @doc """
  Parse ISO 8601 duration (PT1H2M3S) into human-readable string.

  LEARNING: Named captures in regex + pattern matching on the result.
  Regex.named_captures returns a map like %{"h" => "1", "m" => "2", "s" => "3"}.
  """
  def parse_duration(nil), do: "unknown"

  def parse_duration(iso_string) do
    # LEARNING: ~r is a sigil for regex. Named captures use (?<name>pattern).
    regex = ~r/PT(?:(?<h>\d+)H)?(?:(?<m>\d+)M)?(?:(?<s>\d+)S)?/
    captures = Regex.named_captures(regex, iso_string) || %{}

    hours = parse_int(captures["h"])
    minutes = parse_int(captures["m"])
    seconds = parse_int(captures["s"])

    cond do
      hours > 0 ->
        "#{hours}:#{pad(minutes)}:#{pad(seconds)}"

      true ->
        "#{minutes}:#{pad(seconds)}"
    end
  end

  defp parse_int(nil), do: 0
  defp parse_int(""), do: 0
  defp parse_int(s), do: String.to_integer(s)

  defp pad(n), do: String.pad_leading(Integer.to_string(n), 2, "0")
end
