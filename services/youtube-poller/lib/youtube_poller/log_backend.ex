defmodule YoutubePoller.LogBackend do
  @moduledoc """
  Custom :logger handler that forwards every log event to NATS at
  `logs.youtube-poller`, where the api-gateway batches and stores them.
  """
  require Logger

  @subject "logs.youtube-poller"

  def install do
    :logger.add_handler(:yagami_nats, __MODULE__, %{
      level: :info,
      formatter: {Logger.Formatter, []}
    })
  rescue
    _ -> :ok
  end

  def log(event, _config) do
    try do
      payload =
        Jason.encode!(%{
          ts: DateTime.utc_now() |> DateTime.to_iso8601(),
          service: "youtube-poller",
          level: to_string(event.level),
          message: format_msg(event.msg),
          fields: %{}
        })

      YoutubePoller.NatsClient.publish_raw(@subject, payload)
    rescue
      _ -> :ok
    end
  end

  defp format_msg({:string, s}), do: IO.iodata_to_binary(s)
  defp format_msg({:report, r}), do: inspect(r)
  defp format_msg({format, args}) when is_list(args), do: :io_lib.format(format, args) |> IO.iodata_to_binary()
  defp format_msg(other), do: inspect(other)
end
