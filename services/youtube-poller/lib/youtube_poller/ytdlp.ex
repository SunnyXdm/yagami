defmodule YoutubePoller.Ytdlp do
  @moduledoc """
  yt-dlp wrapper for scraping YouTube watch history.

  Watch history is NOT available through the YouTube Data API, so we use
  yt-dlp with browser cookies to scrape it. This module shells out to
  yt-dlp and parses the JSON output.

  LEARNING: System.cmd/3 runs an external command and returns {output, exit_code}.
  It's like subprocess.run() in Python or exec.Command() in Go.
  """
  require Logger

  @doc """
  Scrape watch history using yt-dlp with cookies.
  Returns a list of maps with video_id, title, channel, duration, etc.
  """
  def scrape_watch_history do
    cookies_path = Application.get_env(:youtube_poller, :cookies_path)

    args = [
      "--flat-playlist",
      "-j",
      "--cookies", cookies_path,
      "--playlist-end", "50",
      "https://www.youtube.com/feed/history"
    ]

    case System.cmd("yt-dlp", args, stderr_to_stdout: true) do
      {output, 0} ->
        videos =
          output
          |> String.split("\n", trim: true)
          |> Enum.map(&parse_line/1)
          |> Enum.reject(&is_nil/1)

        Logger.info("Scraped #{length(videos)} videos from watch history")
        {:ok, videos}

      {output, code} ->
        Logger.error("yt-dlp failed (exit #{code}): #{String.slice(output, 0, 200)}")
        {:error, :ytdlp_failed}
    end
  end

  # LEARNING: Each JSON line from yt-dlp is a video entry. We parse it and
  # extract only the fields we need. Jason.decode/1 returns {:ok, map} or {:error, _}.
  defp parse_line(line) do
    case Jason.decode(line) do
      {:ok, data} ->
        %{
          video_id: data["id"],
          title: data["title"],
          channel: data["channel"] || data["uploader"],
          channel_id: data["channel_id"] || data["uploader_id"],
          duration: format_duration(data["duration"]),
          url: data["url"] || "https://www.youtube.com/watch?v=#{data["id"]}"
        }

      {:error, _} ->
        # Skip non-JSON lines (yt-dlp sometimes prints warnings)
        nil
    end
  end

  defp format_duration(nil), do: "unknown"
  defp format_duration(seconds) when is_number(seconds) do
    m = div(trunc(seconds), 60)
    s = rem(trunc(seconds), 60)
    "#{m}:#{String.pad_leading(Integer.to_string(s), 2, "0")}"
  end
  defp format_duration(_), do: "unknown"
end
