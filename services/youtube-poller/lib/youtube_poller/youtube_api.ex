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

  @doc "Fetch all liked videos (auto-paginates). Returns {:ok, list} or {:error, reason}."
  def list_liked_videos(token) do
    case fetch_all_pages("#{@base_url}/videos", %{
      part: "snippet,contentDetails",
      myRating: "like",
      maxResults: 50
    }, token) do
      {:ok, items} -> {:ok, Enum.map(items, &parse_video/1)}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Fetch all subscriptions (auto-paginates). Returns {:ok, list} or {:error, reason}."
  def list_subscriptions(token) do
    case fetch_all_pages("#{@base_url}/subscriptions", %{
      part: "snippet",
      mine: true,
      maxResults: 50,
      order: "alphabetical"
    }, token) do
      {:ok, items} -> {:ok, Enum.map(items, &parse_subscription/1)}
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Private helpers ---

  # LEARNING: Recursive function with accumulator pattern.
  # Each call fetches one page and passes the nextPageToken to the next call.
  # When there's no next page, we return the accumulated items.
  # On error, returns {:error, reason} instead of partial data — this prevents
  # false diffs when only some pages succeed.
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
          {:ok, all}
        end

      {:ok, %{status: status, body: body}} ->
        Logger.error("YouTube API error: #{status} — #{inspect(body)}")
        {:error, "YouTube API HTTP #{status}"}

      {:error, reason} ->
        Logger.error("YouTube API request failed: #{inspect(reason)}")
        {:error, reason}
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
      thumbnail: best_thumbnail(snippet),
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
      thumbnail: best_thumbnail(snippet),
      subscribed_at: snippet["publishedAt"]
    }
  end

  # Pick the highest quality thumbnail available.
  # YouTube provides: default (120x90), medium (320x180), high (480x360),
  # standard (640x480), maxres (1280x720). Not all are always present.
  defp best_thumbnail(snippet) do
    thumbs = snippet["thumbnails"] || %{}

    (get_in(thumbs, ["maxres", "url"]) ||
       get_in(thumbs, ["standard", "url"]) ||
       get_in(thumbs, ["high", "url"]) ||
       get_in(thumbs, ["medium", "url"]))
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
