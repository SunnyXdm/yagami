# LEARNING (Elixir):
#   mix.exs is the project definition — like package.json in JS.
#   It declares the project name, version, Elixir version,
#   dependencies, and OTP application config.
#
#   `application/0` tells OTP which module to start when the app boots.
#   `deps/0` lists hex.pm packages (Elixir's npm).

defmodule YoutubePoller.MixProject do
  use Mix.Project

  def project do
    [
      app: :youtube_poller,
      version: "0.1.0",
      elixir: "~> 1.16",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  # LEARNING: This tells OTP to start YoutubePoller.Application
  # when the app boots. That module sets up the supervision tree.
  def application do
    [
      mod: {YoutubePoller.Application, []},
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"},       # JSON encoding/decoding
      {:postgrex, "~> 0.18"},   # PostgreSQL driver
      {:req, "~> 0.5"},         # HTTP client (for YouTube API)
      {:gnat, "~> 1.8"}         # NATS client
    ]
  end
end
