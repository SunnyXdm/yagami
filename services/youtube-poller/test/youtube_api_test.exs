defmodule YoutubePoller.YoutubeApiTest do
  @moduledoc """
  Tests for the YouTube API client — focuses on parse_duration since
  API calls themselves require network access (tested in integration tests).

  LEARNING: ExUnit is Elixir's built-in test framework.
    - `use ExUnit.Case` brings in `test`, `assert`, `refute`, etc.
    - `describe` groups related tests together.
    - Tests are just functions named `test "description"`.
  """
  use ExUnit.Case, async: true

  alias YoutubePoller.YoutubeApi

  describe "parse_duration/1" do
    test "parses hours, minutes, seconds" do
      assert YoutubeApi.parse_duration("PT1H2M3S") == "1:02:03"
    end

    test "parses minutes and seconds only" do
      assert YoutubeApi.parse_duration("PT5M30S") == "5:30"
    end

    test "parses seconds only" do
      assert YoutubeApi.parse_duration("PT45S") == "0:45"
    end

    test "parses hours only" do
      assert YoutubeApi.parse_duration("PT2H") == "2:00:00"
    end

    test "parses minutes only" do
      assert YoutubeApi.parse_duration("PT10M") == "10:00"
    end

    test "handles zero duration" do
      assert YoutubeApi.parse_duration("PT0S") == "0:00"
    end

    test "handles nil" do
      assert YoutubeApi.parse_duration(nil) == "unknown"
    end

    test "handles large durations" do
      assert YoutubeApi.parse_duration("PT10H5M2S") == "10:05:02"
    end

    test "pads single-digit seconds" do
      assert YoutubeApi.parse_duration("PT3M5S") == "3:05"
    end

    test "pads single-digit minutes when hours present" do
      assert YoutubeApi.parse_duration("PT1H2M") == "1:02:00"
    end
  end
end
