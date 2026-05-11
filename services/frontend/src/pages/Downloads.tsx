import { useEffect, useMemo, useState } from "react";
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
  requester_chat_id?: number | null;
  telegram_chat_id?: number | null;
  telegram_msg_id?: number | null;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

interface LiveUploadState {
  status: string;
  uploaded_bytes?: number;
  total_bytes?: number;
  part?: number;
  total_parts?: number;
  error?: string | null;
}

export function DownloadsPage() {
  const qc = useQueryClient();
  const [liveUploads, setLiveUploads] = useState<Record<string, LiveUploadState>>({});
  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: () => apiGet<Download[]>("downloads?limit=200"),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const es = new EventSource("/api/stream");

    const merge = (videoId: string, next: LiveUploadState) => {
      setLiveUploads((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          ...next,
        },
      }));
    };

    const onProgress = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.video_id) return;
        merge(payload.video_id, {
          status: payload.status || "uploading",
          uploaded_bytes: payload.uploaded_bytes,
          total_bytes: payload.total_bytes,
          part: payload.part,
          total_parts: payload.total_parts,
        });
      } catch {}
    };

    const onTerminal = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.video_id) return;
        merge(payload.video_id, {
          status: payload.status || "uploaded",
          error: payload.error || null,
        });
      } catch {}
    };

    es.addEventListener("download.upload_progress", onProgress as EventListener);
    es.addEventListener("download.uploaded", onTerminal as EventListener);
    es.addEventListener("download.upload_failed", onTerminal as EventListener);

    return () => es.close();
  }, []);

  const rows = useMemo(() => (data || []).map((download) => {
    const live = liveUploads[download.video_id];
    return {
      download,
      live,
      status: live?.status || download.status,
      progress: progressPercent(download, live),
    };
  }), [data, liveUploads]);

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
            {rows.map(({ download: d, live, status, progress }) => (
              <div key={d.video_id} className="min-w-[760px] px-4 py-3 grid grid-cols-[minmax(0,1fr)_140px_110px_110px_40px] gap-3 items-center">
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
                    <div className="text-xs text-muted truncate flex items-center gap-2">
                      <span>{d.channel || "unknown channel"}</span>
                      <span>·</span>
                      <span>{d.video_id}</span>
                      <SourceBadge requesterChatId={d.requester_chat_id} />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <DeliveryBadge status={status} requesterChatId={d.requester_chat_id} />
                      {typeof progress === "number" ? (
                        <span className="text-[11px] text-muted tabular-nums">{progress}%</span>
                      ) : status === "uploading" ? (
                        <span className="text-[11px] text-muted">live progress pending…</span>
                      ) : null}
                    </div>
                    {(live?.status === "uploading" || status === "uploading") && (
                      <div className="mt-2 h-1.5 rounded-full bg-bg overflow-hidden">
                        <div
                          className={cn(
                            "h-full bg-accent2 transition-[width] duration-300",
                            typeof progress !== "number" && "w-1/3 animate-pulse"
                          )}
                          style={typeof progress === "number" ? { width: `${progress}%` } : undefined}
                        />
                      </div>
                    )}
                    {live?.part && live.total_parts && live.total_parts > 1 && (
                      <div className="text-[11px] text-muted mt-1">Uploading part {live.part}/{live.total_parts}</div>
                    )}
                    {(live?.error || d.error) && (
                      <div className="text-[11px] text-err mt-1 line-clamp-2 font-mono">{live?.error || d.error}</div>
                    )}
                  </div>
                </div>
                <StatusBadge s={status} />
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
    : s === "uploaded" ? "bg-ok/20 text-ok"
    : s === "upload_failed" ? "bg-err/20 text-err"
    : s === "uploading" ? "bg-accent/20 text-accent"
    : s === "failed" ? "bg-err/20 text-err"
    : s === "downloading" ? "bg-accent2/20 text-accent2"
    : "bg-bg text-muted";
  return <span className={cn("text-[11px] px-2 py-0.5 rounded-full uppercase tracking-wide", color)}>{s}</span>;
}

function SourceBadge({ requesterChatId }: { requesterChatId?: number | null }) {
  const label = requesterChatId ? "admin link" : "liked";
  const color = requesterChatId ? "bg-accent/20 text-accent" : "bg-accent2/20 text-accent2";
  return <span className={cn("text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide", color)}>{label}</span>;
}

function DeliveryBadge({ status, requesterChatId }: { status: string; requesterChatId?: number | null }) {
  if (status === "uploading") {
    return <span className="text-[11px] text-accent">Uploading to Telegram…</span>;
  }
  if (status === "uploaded") {
    return <span className="text-[11px] text-ok">Uploaded to {requesterChatId ? "admin DM" : "likes chat"}</span>;
  }
  if (status === "upload_failed") {
    return <span className="text-[11px] text-err">Telegram upload failed</span>;
  }
  if (status === "completed") {
    return <span className="text-[11px] text-muted">Download complete</span>;
  }
  if (status === "downloading") {
    return <span className="text-[11px] text-accent2">Downloading with yt-dlp…</span>;
  }
  return <span className="text-[11px] text-muted">Queued for processing</span>;
}

function progressPercent(download: Download, live?: LiveUploadState) {
  if (!live || typeof live.uploaded_bytes !== "number" || typeof live.total_bytes !== "number" || live.total_bytes <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round((live.uploaded_bytes / live.total_bytes) * 100)));
}
