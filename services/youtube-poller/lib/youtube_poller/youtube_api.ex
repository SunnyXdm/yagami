defmodule YoutubePoller.YoutubeApi do
  @moduledoc "YouTube Data API v3 — liked videos & subscriptions."
  require Logger

  @base_url "https://www.googleapis.com/youtube/v3"

  def list_liked_videos(token) do
    case fetch_all_pages("#{@base_url}/videos",
           %{part: "snippet,contentDetails", myRating: "like", maxResults: 50},
           token) do
      {:ok, items} -> {:ok, Enum.map(items, &parse_video/1)}
      err -> err
    end
  end

  def list_subscriptions(token) do
    case fetch_all_pages("#{@base_url}/subscriptions",
           %{part: "snippet", mine: "true", maxResults: 50},
           token) do
      {:ok, items} -> {:ok, Enum.map(items, &parse_subscription/1)}
      err -> err
    end
  end

  defp fetch_all_pages(url, params, token, page_token \\ nil, acc \\ []) do
    params = if page_token, do: Map.put(params, :pageToken, page_token), else: params
    headers = [{"authorization", "Bearer #{token}"}]

    case Req.get(url, params: params, headers: headers) do
      {:ok, %{status: 200, body: body}} ->
        items = Map.get(body, "items", [])
        next = Map.get(body, "nextPageToken")
        all = acc ++ items
        if next, do: fetch_all_pages(url, params, token, next, all), else: {:ok, all}

      {:ok, %{status: 403, body: body}} ->
        if quota_exceeded?(body) do
          Logger.error("YouTube API quota exceeded")
          {:error, :quota_exceeded}
        else
          Logger.error("YouTube API 403: #{inspect(body)}")
          {:error, "YouTube API HTTP 403"}
        end

      {:ok, %{status: status, body: body}} ->
        Logger.error("YouTube API error: #{status} — #{inspect(body)}")
        {:error, "YouTube API HTTP #{status}"}

      {:error, reason} ->
        Logger.error("YouTube API request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp quota_exceeded?(%{"error" => %{"errors" => errors}}) when is_list(errors) do
    Enum.any?(errors, fn e -> e["reason"] == "quotaExceeded" end)
  end
  defp quota_exceeded?(_), do: false

  defp parse_video(item) do
    snippet = item["snippet"] || %{}
    content = item["contentDetails"] || %{}
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
    snippet = item["snippet"] || %{}
    res = snippet["resourceId"] || %{}
    %{
      channel_id: res["channelId"],
      channel_title: snippet["title"],
      thumbnail: best_thumbnail(snippet),
      published_at: snippet["publishedAt"]
    }
  end

  defp best_thumbnail(snippet) do
    thumbs = snippet["thumbnails"] || %{}
    get_in(thumbs, ["maxres", "url"]) ||
      get_in(thumbs, ["standard", "url"]) ||
      get_in(thumbs, ["high", "url"]) ||
      get_in(thumbs, ["medium", "url"]) ||
      get_in(thumbs, ["default", "url"])
  end

  def parse_duration(nil), do: "unknown"
  def parse_duration(iso) do
    regex = ~r/PT(?:(?<h>\d+)H)?(?:(?<m>\d+)M)?(?:(?<s>\d+)S)?/
    c = Regex.named_captures(regex, iso) || %{}
    h = parse_int(c["h"]); m = parse_int(c["m"]); s = parse_int(c["s"])
    if h > 0, do: "#{h}:#{pad(m)}:#{pad(s)}", else: "#{m}:#{pad(s)}"
  end

  defp parse_int(nil), do: 0
  defp parse_int(""), do: 0
  defp parse_int(s), do: String.to_integer(s)
  defp pad(n), do: String.pad_leading(Integer.to_string(n), 2, "0")
end
