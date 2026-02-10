defmodule YoutubePoller.DBTest do
  @moduledoc """
  Tests for the DB module's config parsing.
  Actual DB operations require a running PostgreSQL (integration test).
  """
  use ExUnit.Case, async: true

  alias YoutubePoller.DB

  describe "config/0" do
    test "parses a standard DATABASE_URL" do
      Application.put_env(:youtube_poller, :database_url,
        "postgres://myuser:mypass@dbhost:5433/mydb"
      )

      config = DB.config()

      assert Keyword.get(config, :hostname) == "dbhost"
      assert Keyword.get(config, :port) == 5433
      assert Keyword.get(config, :database) == "mydb"
      assert Keyword.get(config, :username) == "myuser"
      assert Keyword.get(config, :password) == "mypass"
    end

    test "parses URL with default port" do
      Application.put_env(:youtube_poller, :database_url,
        "postgres://user:pass@localhost/testdb"
      )

      config = DB.config()

      assert Keyword.get(config, :hostname) == "localhost"
      # URI.parse returns nil for missing port
      assert Keyword.get(config, :port) == nil || Keyword.get(config, :port) == 5432
      assert Keyword.get(config, :database) == "testdb"
    end

    test "strips leading slash from database name" do
      Application.put_env(:youtube_poller, :database_url,
        "postgres://u:p@h:5432/mydb"
      )

      config = DB.config()
      # Should be "mydb", not "/mydb"
      refute String.starts_with?(Keyword.get(config, :database), "/")
    end
  end
end
