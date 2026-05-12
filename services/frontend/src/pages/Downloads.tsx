import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { cn, formatBytes, formatRelative } from "../lib/utils";
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

    const onUploadProgress = (event: MessageEvent) => {
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
    <div className="space-y-6">
      <Header
        eyebrow="Queue and delivery"
        title="Delivery lanes"
        subtitle="Priority admin jobs, live yt-dlp telemetry, and Telegram delivery tracking in one editorial queue view."
        right={
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-panel px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ash">
              200 recent jobs
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-panel px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ash">
              refreshes every 5s
            </span>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active lane" value={summary.active} sub={`${summary.downloading} pulling · ${summary.uploading} pushing`} tone="dark" />
        <MetricCard label="Admin priority" value={summary.admin} sub="Jobs currently occupying the fast lane" tone="brand" />
        <MetricCard label="Completed" value={summary.completed} sub={`${formatBytes(summary.bytes)} archived in recent history`} tone="light" />
        <MetricCard
          label="Failures"
          value={summary.failed}
          sub={summary.failed > 0 ? "Needs review or retry" : "No visible queue faults"}
          tone={summary.failed > 0 ? "danger" : "paper"}
        />
      </div>

      <div className="space-y-3">
        {(data?.length ?? 0) === 0 ? (
          <div className="surface-paper px-6 py-12 text-center">
            <div className="mono-caps">Queue is quiet</div>
            <div className="mt-4 text-[40px] leading-[0.98] tracking-[-0.03em] text-ink">No downloads yet</div>
            <div className="mx-auto mt-3 max-w-xl text-[15px] leading-[1.5] text-muted">
              Send a YouTube link to the Telegram bot and it will appear here with quality choice,
              yt-dlp progress, and Telegram delivery state.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(({ download, live, status, progress }) => (
              <article
                key={download.video_id}
                className="group overflow-hidden rounded-[12px] border border-hairline bg-light text-ink shadow-softdrop"
                style={{ contentVisibility: "auto", containIntrinsicSize: "260px" }}
              >
                <div className="grid gap-4 p-4 xl:grid-cols-[240px_minmax(0,1fr)_180px] xl:items-start xl:p-5">
                  <div className="relative aspect-video overflow-hidden rounded-[6px] border border-hairline bg-paper">
                    {download.thumbnail_url ? (
                      <img
                        src={download.thumbnail_url}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                        alt=""
                      />
                    ) : (
                      <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(60,71,88,.16),transparent_60%)]" />
                    )}
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
                      <SourceBadge requesterChatId={download.requester_chat_id} />
                      <StatusBadge s={status} />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/85 via-bg/30 to-transparent p-3 text-xs text-text/90">
                      {typeof progress === "number" ? `${progress}% in motion` : "Awaiting telemetry"}
                    </div>
                  </div>

                  <div className="min-w-0">
                    {download.url ? (
                      <a
                        href={download.url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-[28px] leading-[1.02] tracking-[-0.03em] text-ink hover:text-accent"
                      >
                        {download.title || download.video_id}
                      </a>
                    ) : (
                      <div className="line-clamp-2 text-[28px] leading-[1.02] tracking-[-0.03em] text-ink">
                        {download.title || download.video_id}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <MetaPill>{download.channel || "unknown channel"}</MetaPill>
                      <MetaPill tone="subtle">{download.video_id}</MetaPill>
                      {download.attempts > 1 && <MetaPill tone="warning">retry #{download.attempts}</MetaPill>}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <DeliveryBadge status={status} requesterChatId={download.requester_chat_id} />
                      {typeof progress === "number" ? (
                        <span className="text-xs tabular-nums text-muted">{progress}%</span>
                      ) : status === "uploading" || status === "downloading" ? (
                        <span className="text-xs text-muted">live progress pending...</span>
                      ) : null}
                    </div>

                    {(live?.status === "uploading" ||
                      live?.status === "downloading" ||
                      status === "uploading" ||
                      status === "downloading") && (
                      <div className="mt-4 rounded-[6px] border border-hairline bg-paper p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                          <span>{live?.progress_text || (status === "uploading" ? "Uploading to Telegram..." : "Downloading with yt-dlp...")}</span>
                          <span className="tabular-nums">{typeof progress === "number" ? `${progress}%` : "syncing"}</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-light">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300",
                              status === "uploading" ? "bg-accent" : "bg-ink",
                              typeof progress !== "number" && "w-1/3 animate-pulse",
                            )}
                            style={typeof progress === "number" ? { width: `${progress}%` } : undefined}
                          />
                        </div>
                        {(live?.speed_text || live?.eta_text || live?.part) && (
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
                            {live?.speed_text && <span>Speed {live.speed_text}</span>}
                            {live?.eta_text && <span>ETA {live.eta_text}</span>}
                            {live?.part && live.total_parts && live.total_parts > 1 && (
                              <span>Part {live.part}/{live.total_parts}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {(live?.error || download.error) && (
                      <div className="mt-3 rounded-[6px] border border-err/30 bg-err/5 px-3 py-3 font-mono text-[11px] leading-relaxed text-err">
                        {live?.error || download.error}
                      </div>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-4 xl:flex-col xl:items-end">
                    <div className="grid gap-2 text-xs text-muted">
                      <InfoStack label="Size" value={formatBytes(download.file_size || 0)} />
                      <InfoStack label="Updated" value={formatRelative(download.completed_at || download.updated_at)} />
                      <InfoStack label="Route" value={download.requester_chat_id ? "Admin DM" : "Likes chat"} />
                    </div>
                    <button
                      onClick={() => retry.mutate(download.video_id)}
                      className="button-secondary-light gap-2"
                      title="Retry"
                    >
                      <RefreshCw size={14} />
                      Retry
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const color = s === "completed" || s === "uploaded"
    ? "border-ok bg-ok text-ink"
    : s === "upload_failed" || s === "failed"
      ? "border-err bg-err text-text"
      : s === "uploading"
        ? "border-accent bg-accent text-ink"
        : s === "downloading"
          ? "border-linkBlueSoft bg-linkBlueSoft text-ink"
          : "border-border bg-bg/90 text-text";

  return <span className={cn("inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em]", color)}>{s}</span>;
}

function SourceBadge({ requesterChatId }: { requesterChatId?: number | null }) {
  const label = requesterChatId ? "admin link" : "auto like";
  const color = requesterChatId ? "border-accent bg-accent text-ink" : "border-border bg-bg/90 text-text";
  return <span className={cn("inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em]", color)}>{label}</span>;
}

function DeliveryBadge({ status, requesterChatId }: { status: string; requesterChatId?: number | null }) {
  if (status === "uploading") {
    return <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[13px] text-ink">Uploading to Telegram...</span>;
  }
  if (status === "downloading") {
    return <span className="rounded-full border border-linkBlue/20 bg-linkBlue/5 px-3 py-1 text-[13px] text-linkBlue">Downloading with yt-dlp...</span>;
  }
  if (status === "uploaded") {
    return <span className="rounded-full border border-ok/20 bg-ok/10 px-3 py-1 text-[13px] text-ink">Uploaded to {requesterChatId ? "admin DM" : "likes chat"}</span>;
  }
  if (status === "upload_failed") {
    return <span className="rounded-full border border-err/20 bg-err/5 px-3 py-1 text-[13px] text-err">Telegram upload failed</span>;
  }
  if (status === "failed") {
    return <span className="rounded-full border border-err/20 bg-err/5 px-3 py-1 text-[13px] text-err">Download failed</span>;
  }
  if (status === "completed") {
    return <span className="rounded-full border border-hairline bg-paper px-3 py-1 text-[13px] text-muted">Download complete</span>;
  }
  return <span className="rounded-full border border-hairline bg-paper px-3 py-1 text-[13px] text-muted">Queued for processing</span>;
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
  tone = "dark",
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "dark" | "brand" | "light" | "paper" | "danger";
}) {
  const cardClass = tone === "brand"
    ? "rounded-[12px] border border-accent bg-accent p-5 text-ink"
    : tone === "light"
      ? "surface-light p-5"
      : tone === "paper"
        ? "surface-paper p-5"
        : tone === "danger"
          ? "rounded-[12px] border border-err/25 bg-[#fff7f6] p-5 text-ink shadow-softdrop"
          : "surface-dark p-5";

  return (
    <div className={cardClass}>
      <div className="mono-caps">{label}</div>
      <div className={cn("mt-5 font-display text-[48px] leading-none tracking-[-0.035em] tabular-nums", tone === "dark" ? "text-text" : "text-ink")}>
        {value.toLocaleString()}
      </div>
      <div className={cn("mt-3 text-[15px] leading-[1.5]", tone === "dark" ? "text-ash" : "text-muted")}>{sub}</div>
    </div>
  );
}

function MetaPill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "subtle" | "warning" }) {
  const toneClass = tone === "warning"
    ? "border-warn/30 bg-warn/10 text-ink"
    : tone === "subtle"
      ? "border-hairline bg-paper text-muted"
      : "border-hairline bg-paper text-ink";

  return <span className={cn("rounded-full border px-3 py-1 text-[13px]", toneClass)}>{children}</span>;
}

function InfoStack({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-hairline bg-paper px-3 py-3 text-left xl:text-right">
      <div className="mono-caps">{label}</div>
      <div className="mt-2 text-[15px] text-ink">{value}</div>
    </div>
  );
}
