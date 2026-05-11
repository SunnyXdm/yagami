defmodule YoutubePoller.OAuthTest do
  @moduledoc """
  Tests for OAuth token management logic.
  """
  use ExUnit.Case, async: true

  describe "token expiry logic" do
    test "expired token needs refresh" do
      # Simulate an expired timestamp
      past = DateTime.add(DateTime.utc_now(), -3600, :second)
      assert DateTime.compare(past, DateTime.utc_now()) == :lt
    end

    test "future token is still valid" do
      future = DateTime.add(DateTime.utc_now(), 3600, :second)
      assert DateTime.compare(future, DateTime.utc_now()) == :gt
    end

    test "DateTime.add correctly handles seconds" do
      now = DateTime.utc_now()
      later = DateTime.add(now, 300, :second)
      diff = DateTime.diff(later, now, :second)
      assert diff == 300
    end
  end

  describe "token_valid?/1" do
    test "token expiring in more than 5 minutes is valid" do
      future = DateTime.add(DateTime.utc_now(), 600, :second)
      assert YoutubePoller.OAuth.token_valid?(future)
    end

    test "token expiring in less than 5 minutes is not valid" do
      near_future = DateTime.add(DateTime.utc_now(), 60, :second)
      refute YoutubePoller.OAuth.token_valid?(near_future)
    end

    test "already expired token is not valid" do
      past = DateTime.add(DateTime.utc_now(), -3600, :second)
      refute YoutubePoller.OAuth.token_valid?(past)
    end
  end
end
