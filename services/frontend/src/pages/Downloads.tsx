import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiGet, apiPost, apiStream } from "../lib/api";
import { bestYoutubeThumbnail, cn, formatBytes, formatRelative, useNow } from "../lib/utils";
import { Header } from "./Dashboard";

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
  progress_percent?: number;
  progress_text?: string;
  speed_text?: string;
  eta_text?: string;
  part?: number;
  total_parts?: number;
  error?: string | null;
}

export function DownloadsPage() {
  const qc = useQueryClient();
  const [liveUploads, setLiveUploads] = useState<Record<string, LiveUploadState>>({});
  const now = useNow();
  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: () => apiGet<Download[]>("downloads?limit=200"),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const es = apiStream();

    const merge = (videoId: string, next: LiveUploadState) => {
      setLiveUploads((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          ...next,
        },
      }));
    };

    const onUploadProgress = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.video_id) return;
        merge(payload.video_id, {
          status: payload.status || "uploading",
          uploaded_bytes: payload.uploaded_bytes,
          total_bytes: payload.total_bytes,
          progress_text: payload.progress_text,
          speed_text: payload.speed_text,
          eta_text: payload.eta_text,
          part: payload.part,
          total_parts: payload.total_parts,
        });
      } catch {}
    };

    const onDownloadProgress = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.video_id) return;
        merge(payload.video_id, {
          status: payload.status || "downloading",
          progress_percent: payload.progress_percent,
          progress_text: payload.progress_text,
          speed_text: payload.speed_text,
          eta_text: payload.eta_text,
        });
      } catch {}
    };

    const onTerminal = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.video_id) return;
        merge(payload.video_id, {
          status: payload.status || "uploaded",
          uploaded_bytes: payload.uploaded_bytes,
          total_bytes: payload.total_bytes,
          progress_percent: payload.progress_percent,
          speed_text: payload.speed_text,
          eta_text: payload.eta_text,
          error: payload.error || null,
        });
      } catch {}
    };

    const onDownloadComplete = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.video_id) return;
        merge(payload.video_id, {
          status: payload.success === false ? "failed" : "completed",
          progress_percent: payload.success === false ? undefined : 100,
          error: payload.error || null,
        });
      } catch {}
    };

    es.addEventListener("download.progress", onDownloadProgress as EventListener);
    es.addEventListener("download.upload_progress", onUploadProgress as EventListener);
    es.addEventListener("download.complete", onDownloadComplete as EventListener);
    es.addEventListener("download.uploaded", onTerminal as EventListener);
    es.addEventListener("download.upload_failed", onTerminal as EventListener);

    return () => es.close();
  }, []);

  const rows = useMemo(
    () =>
      (data || []).map((download) => {
        const live = liveUploads[download.video_id];
        return {
          download,
          live,
          status: live?.status || download.status,
          progress: progressPercent(live),
        };
      }),
    [data, liveUploads],
  );

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, { download, status }) => {
        const isActive = status === "queued" || status === "downloading" || status === "uploading";
        if (isActive) acc.active += 1;
        if (status === "downloading") acc.downloading += 1;
        if (status === "uploading") acc.uploading += 1;
        if (status === "uploaded" || status === "completed") acc.completed += 1;
        if (status === "failed" || status === "upload_failed") acc.failed += 1;
        if (download.requester_chat_id && isActive) acc.admin += 1;
        acc.bytes += download.file_size || 0;
        return acc;
      },
      { active: 0, downloading: 0, uploading: 0, completed: 0, failed: 0, admin: 0, bytes: 0 },
    );
  }, [rows]);

  const retry = useMutation({
    mutationFn: (id: string) => apiPost(`downloads/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  return (
    <div className="space-y-5">
      <Header
        eyebrow="Downloads"
        title="Download queue"
        right={
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-[8px] border border-border bg-panel px-3 py-2 text-[13px] text-body">
              200 recent jobs
            </span>
            <span className="inline-flex items-center rounded-[8px] border border-border bg-panel px-3 py-2 text-[13px] text-body">
              refreshes every 5s
            </span>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active" value={summary.active} sub={`${summary.downloading} downloading · ${summary.uploading} uploading`} tone="blue" />
        <MetricCard label="Admin" value={summary.admin} sub="Admin-requested active jobs" tone="white" />
        <MetricCard label="Completed" value={summary.completed} sub={`${formatBytes(summary.bytes)} in recent jobs`} tone="green" />
        <MetricCard
          label="Failed"
          value={summary.failed}
          sub={summary.failed > 0 ? "Needs review or retry" : "No queue faults"}
          tone={summary.failed > 0 ? "red" : "yellow"}
        />
      </div>

      <div className="space-y-3">
        {(data?.length ?? 0) === 0 ? (
          <div className="surface-dark px-5 py-8 text-center">
            <div className="text-[13px] font-medium text-muted">Queue is quiet</div>
            <div className="mt-2 text-[24px] font-semibold leading-[1.2] text-text">No downloads yet</div>
            <div className="mx-auto mt-2 max-w-xl text-[14px] leading-[1.6] text-body">
              Send a YouTube link to the Telegram bot and it will appear here with quality choice,
              yt-dlp progress, and Telegram delivery state.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(({ download, live, status, progress }) => {
              const active = status === "uploading" || status === "downloading";
              const terminal = status === "uploaded" || status === "completed" || status === "failed" || status === "upload_failed";
              const telemetry = live?.progress_text || (active ? (status === "uploading" ? "Uploading to Telegram" : "Downloading with yt-dlp") : null);

              return (
                <article key={download.video_id} className="rounded-[8px] border border-border bg-panel text-text">
                  <div className="grid gap-3 p-3 lg:grid-cols-[128px_minmax(0,1fr)_auto] lg:items-start">
                    <div className="space-y-2">
                      <div className="aspect-video overflow-hidden rounded-[8px] border border-border bg-card">
                        {download.thumbnail_url ? (
                          <img
                            src={bestYoutubeThumbnail(download.thumbnail_url)}
                            onError={(event) => {
                              if (download.thumbnail_url && event.currentTarget.src !== download.thumbnail_url) {
                                event.currentTarget.src = download.thumbnail_url;
                              }
                            }}
                            className="h-full w-full object-cover transition duration-500 hover:scale-[1.02]"
                            alt=""
                          />
                        ) : (
                          <div className="h-full w-full bg-card" />
                        )}
                      </div>
                      <SourceBadge requesterChatId={download.requester_chat_id} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start gap-2">
                        <StatusBadge s={status} />
                        <DeliveryBadge status={status} requesterChatId={download.requester_chat_id} />
                      </div>

                      {download.url ? (
                        <a
                          href={download.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block line-clamp-2 text-[16px] font-semibold leading-[1.3] text-text hover:text-white"
                        >
                          {download.title ?? <span className="text-muted">Untitled</span>}
                        </a>
                      ) : (
                        <div className="mt-2 line-clamp-2 text-[16px] font-semibold leading-[1.3] text-text">
                          {download.title ?? <span className="text-muted">Untitled</span>}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-2">
                        <MetaPill>{download.channel || "unknown channel"}</MetaPill>
                        <MetaPill tone="subtle">{download.video_id}</MetaPill>
                        {download.attempts > 1 && <MetaPill tone="warning">retry #{download.attempts}</MetaPill>}
                      </div>

                      {active && (
                        <div className="mt-3 rounded-[8px] border border-border bg-card px-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-body">
                            <span>{telemetry}</span>
                            <span className="tabular-nums">{typeof progress === "number" ? `${progress}%` : "syncing"}</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
                            <div
                              className={cn(
                                "h-full rounded-full transition-[width] duration-300",
                                status === "uploading" ? "bg-accentBlue" : "bg-white",
                                typeof progress !== "number" && "w-1/3 animate-pulse",
                              )}
                              style={typeof progress === "number" ? { width: `${progress}%` } : undefined}
                            />
                          </div>
                          {(live?.speed_text || live?.eta_text || live?.part) && (
                            <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-muted">
                              {live?.speed_text && <span>Speed {live.speed_text}</span>}
                              {live?.eta_text && <span>ETA {live.eta_text}</span>}
                              {live?.part && live.total_parts && live.total_parts > 1 && (
                                <span>Part {live.part}/{live.total_parts}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!active && terminal && live?.speed_text && (
                        <div className="mt-3 text-[12px] text-muted">Last upload speed {live.speed_text}</div>
                      )}

                      {(live?.error || download.error) && (
                        <div className="mt-3 rounded-[8px] border border-err/30 bg-err/10 px-3 py-3 text-[12px] leading-relaxed text-err">
                          {live?.error || download.error}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-start justify-between gap-2 lg:min-w-[168px] lg:flex-col lg:items-end">
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted lg:w-full lg:grid-cols-1">
                        <InfoStack label="Size" value={formatBytes(download.file_size || 0)} />
                        <InfoStack label="Updated" value={formatRelative(download.completed_at || download.updated_at, now)} />
                        <InfoStack label="Route" value={download.requester_chat_id ? "Admin DM" : "Likes chat"} />
                      </div>
                      <button
                        onClick={() => retry.mutate(download.video_id)}
                        className="button-secondary-dark h-9 gap-2"
                        title="Retry"
                      >
                        <RefreshCw size={14} />
                        Retry
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const dot = s === "completed" || s === "uploaded"
    ? "bg-accentGreen"
    : s === "upload_failed" || s === "failed"
      ? "bg-accentRed"
      : s === "uploading"
        ? "bg-accentBlue"
        : s === "downloading"
          ? "bg-white"
          : "bg-white/45";

  return (
    <span className="inline-flex items-center gap-2 rounded-[8px] border border-white/12 bg-bg/80 px-3 py-1.5 text-[12px] text-text backdrop-blur">
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      {s.replace(/_/g, " ")}
    </span>
  );
}

function SourceBadge({ requesterChatId }: { requesterChatId?: number | null }) {
  const label = requesterChatId ? "admin link" : "auto like";
  return (
    <span className="inline-flex items-center gap-2 rounded-[8px] border border-white/12 bg-bg/80 px-3 py-1.5 text-[12px] text-text backdrop-blur">
      <span className={cn("h-2 w-2 rounded-full", requesterChatId ? "bg-white" : "bg-white/45")} />
      {label}
    </span>
  );
}

function DeliveryBadge({ status, requesterChatId }: { status: string; requesterChatId?: number | null }) {
  if (status === "uploading") {
    return <span className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[13px] text-body">Uploading to Telegram...</span>;
  }
  if (status === "downloading") {
    return <span className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[13px] text-body">Downloading with yt-dlp...</span>;
  }
  if (status === "uploaded") {
    return <span className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[13px] text-text">Uploaded to {requesterChatId ? "admin DM" : "likes chat"}</span>;
  }
  if (status === "upload_failed") {
    return <span className="rounded-[8px] border border-err/30 bg-err/10 px-3 py-1.5 text-[13px] text-err">Telegram upload failed</span>;
  }
  if (status === "failed") {
    return <span className="rounded-[8px] border border-err/30 bg-err/10 px-3 py-1.5 text-[13px] text-err">Download failed</span>;
  }
  if (status === "completed") {
    return <span className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[13px] text-body">Download complete</span>;
  }
  return <span className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[13px] text-body">Queued for processing</span>;
}

function progressPercent(live?: LiveUploadState) {
  if (typeof live?.progress_percent === "number") {
    return Math.max(0, Math.min(100, Math.round(live.progress_percent)));
  }
  if (!live || typeof live.uploaded_bytes !== "number" || typeof live.total_bytes !== "number" || live.total_bytes <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round((live.uploaded_bytes / live.total_bytes) * 100)));
}

function MetricCard({
  label,
  value,
  sub,
  tone = "blue",
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "blue" | "white" | "green" | "yellow" | "red";
}) {
  const accentClass = tone === "white"
    ? "bg-white"
    : tone === "green"
      ? "bg-accentGreen"
      : tone === "yellow"
        ? "bg-accentYellow"
        : tone === "red"
          ? "bg-accentRed"
          : "bg-accentBlue";

  return (
    <div className="surface-dark p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-8 w-8 place-items-center rounded-[7px] border border-border bg-card">
          <span className={cn("h-2.5 w-2.5 rounded-[3px]", accentClass)} />
        </div>
        <div className="text-[28px] font-semibold leading-none text-text tabular-nums">{value.toLocaleString()}</div>
      </div>
      <div className="mt-4 text-[13px] font-medium text-text">{label}</div>
      <div className="mt-1 text-[13px] leading-[1.5] text-body">{sub}</div>
    </div>
  );
}

function MetaPill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "subtle" | "warning" }) {
  const toneClass = tone === "warning"
    ? "text-accentYellow"
    : tone === "subtle"
      ? "text-muted"
      : "text-body";

  return <span className={cn("rounded-[7px] border border-border bg-card px-2.5 py-1 text-[12px]", toneClass)}>{children}</span>;
}

function InfoStack({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-border bg-card px-3 py-2 text-left xl:text-right">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-[13px] text-text">{value}</div>
    </div>
  );
}
