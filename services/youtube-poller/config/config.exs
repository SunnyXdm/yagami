# LEARNING: config.exs runs at COMPILE time. Only put values here
# that are known at build time (not env vars — those are runtime).
import Config

config :logger,
  level: :info
