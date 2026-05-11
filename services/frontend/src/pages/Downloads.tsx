import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../lib/api";
import { Header } from "./Dashboard";
import { formatBytes, formatRelative, cn } from "../lib/utils";
import { RefreshCw } from "lucide-react";

interface Download {
  video_id: string;
  title?: string | null;
  url?: string | null;
  channel?: string | null;
  status: string;
  file_size?: number | null;
  attempts: number;
  error?: string | null;
  thumbnail_url?: string | null;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export function DownloadsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: () => apiGet<Download[]>("downloads?limit=200"),
    refetchInterval: 5_000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => apiPost(`downloads/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  return (
    <div>
      <Header title="Downloads" subtitle="yt-dlp queue with per-job status, errors, and a retry button." />
      <div className="bg-panel/60 border border-border rounded-xl overflow-x-auto">
        {(data?.length ?? 0) === 0 ? (
          <div className="p-8 text-muted text-center">
            No downloads yet. Send a YouTube link to your Telegram bot — it will appear here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {(data || []).map((d) => (
              <div key={d.video_id} className="min-w-[760px] px-4 py-3 grid grid-cols-[minmax(0,1fr)_120px_100px_90px_40px] gap-3 items-center">
                <div className="min-w-0 flex items-center gap-3">
                  {d.thumbnail_url ? (
                    <img src={d.thumbnail_url} className="h-12 aspect-video object-cover rounded-md bg-bg flex-shrink-0" alt="" />
                  ) : (
                    <div className="h-12 aspect-video rounded-md bg-bg flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="truncate text-sm block hover:text-accent2">
                        {d.title || d.video_id}
                      </a>
                    ) : (
                      <div className="truncate text-sm">{d.title || d.video_id}</div>
                    )}
                    <div className="text-xs text-muted truncate">
                      {d.channel || "unknown channel"} · {d.video_id}
                    </div>
                    {d.error && (
                      <div className="text-[11px] text-err mt-1 line-clamp-2 font-mono">{d.error}</div>
                    )}
                  </div>
                </div>
                <StatusBadge s={d.status} />
                <div className="text-xs text-muted tabular-nums">{formatBytes(d.file_size || 0)}</div>
                <div className="text-xs text-muted">{formatRelative(d.completed_at || d.updated_at)}</div>
                <button
                  onClick={() => retry.mutate(d.video_id)}
                  className="text-muted hover:text-text"
                  title="Retry"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const color = s === "completed" ? "bg-ok/20 text-ok"
    : s === "failed" ? "bg-err/20 text-err"
    : s === "downloading" ? "bg-accent2/20 text-accent2"
    : "bg-bg text-muted";
  return <span className={cn("text-[11px] px-2 py-0.5 rounded-full uppercase tracking-wide", color)}>{s}</span>;
}
