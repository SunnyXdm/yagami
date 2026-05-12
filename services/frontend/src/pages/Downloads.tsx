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
    es.addEventListener("download.upload_progress", onProgress as EventListener);
    es.addEventListener("download.complete", onDownloadComplete as EventListener);
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
      progress: progressPercent(live),
    };
  }), [data, liveUploads]);

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
      { active: 0, downloading: 0, uploading: 0, completed: 0, failed: 0, admin: 0, bytes: 0 }
    );
  }, [rows]);

  const retry = useMutation({
    mutationFn: (id: string) => apiPost(`downloads/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  return (
    <div className="space-y-6">
      <Header
        title="Downloads"
        subtitle="Priority lane for admin links, live yt-dlp telemetry, and Telegram delivery tracking in one view."
        right={
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.26em] text-muted">
            <span className="rounded-full border border-border/70 bg-bg/45 px-3 py-2">200 recent jobs</span>
            <span className="rounded-full border border-border/70 bg-bg/45 px-3 py-2">refreshes every 5s</span>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active lane" value={summary.active} sub={`${summary.downloading} pulling · ${summary.uploading} pushing`} tone="warm" />
        <MetricCard label="Admin priority" value={summary.admin} sub="Jobs currently occupying the fast lane" tone="cool" />
        <MetricCard label="Completed" value={summary.completed} sub={`${formatBytes(summary.bytes)} archived in recent history`} />
        <MetricCard label="Failures" value={summary.failed} sub={summary.failed > 0 ? "Needs review or retry" : "No visible queue faults"} tone={summary.failed > 0 ? "danger" : "neutral"} />
      </div>

      <div className="space-y-3">
        {(data?.length ?? 0) === 0 ? (
          <div className="rounded-[28px] border border-dashed border-border/70 bg-panel/45 px-6 py-12 text-center shadow-panel">
            <div className="text-[10px] uppercase tracking-[0.34em] text-muted/80">Queue is quiet</div>
            <div className="mt-4 font-display text-4xl text-text">No downloads yet</div>
            <div className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Send a YouTube link to the Telegram bot and it will appear here with quality choice,
              yt-dlp progress, and Telegram delivery state.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(({ download: d, live, status, progress }) => (
              <article
                key={d.video_id}
                className="group relative overflow-hidden rounded-[28px] border border-border/70 bg-panel/55 shadow-panel"
                style={{ contentVisibility: "auto", containIntrinsicSize: "260px" }}
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <div className="grid gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)_150px] lg:items-start lg:p-5">
                  <div className="relative overflow-hidden rounded-[22px] border border-border/70 bg-bg/45 aspect-video">
                    {d.thumbnail_url ? (
                      <img src={d.thumbnail_url} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" alt="" />
                    ) : (
                      <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(84,146,255,.18),transparent_60%)]" />
                    )}
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
                      <SourceBadge requesterChatId={d.requester_chat_id} />
                      <StatusBadge s={status} />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/85 via-bg/30 to-transparent p-3 text-xs text-text/90">
                      {typeof progress === "number" ? `${progress}% in motion` : "Awaiting telemetry"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-lg font-medium leading-tight text-text hover:text-accent"
                      >
                        {d.title || d.video_id}
                      </a>
                    ) : (
                      <div className="line-clamp-2 text-lg font-medium leading-tight text-text">{d.title || d.video_id}</div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <MetaPill>{d.channel || "unknown channel"}</MetaPill>
                      <MetaPill tone="subtle">{d.video_id}</MetaPill>
                      {d.attempts > 1 && <MetaPill tone="warning">retry #{d.attempts}</MetaPill>}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <DeliveryBadge status={status} requesterChatId={d.requester_chat_id} />
                      {typeof progress === "number" ? (
                        <span className="text-xs tabular-nums text-muted">{progress}%</span>
                      ) : (status === "uploading" || status === "downloading") ? (
                        <span className="text-xs text-muted">live progress pending…</span>
                      ) : null}
                    </div>

                    {(live?.status === "uploading" || live?.status === "downloading" || status === "uploading" || status === "downloading") && (
                      <div className="mt-4 rounded-[20px] border border-border/60 bg-bg/35 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                          <span>{live?.progress_text || (status === "uploading" ? "Uploading to Telegram…" : "Downloading with yt-dlp…")}</span>
                          <span className="tabular-nums">{typeof progress === "number" ? `${progress}%` : "syncing"}</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface/55">
                          <div
                            className={cn(
                              "h-full rounded-full bg-[linear-gradient(90deg,rgba(255,106,66,.95),rgba(84,146,255,.9))] transition-[width] duration-300",
                              typeof progress !== "number" && "w-1/3 animate-pulse"
                            )}
                            style={typeof progress === "number" ? { width: `${progress}%` } : undefined}
                          />
                        </div>
                        {(live?.speed_text || live?.eta_text || live?.part) && (
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
                            {live?.speed_text && <span>Speed {live.speed_text}</span>}
                            {live?.eta_text && <span>ETA {live.eta_text}</span>}
                            {live?.part && live.total_parts && live.total_parts > 1 && <span>Part {live.part}/{live.total_parts}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {(live?.error || d.error) && (
                      <div className="mt-3 rounded-2xl border border-err/30 bg-err/8 px-3 py-2 text-[11px] leading-relaxed text-err font-mono">
                        {live?.error || d.error}
                      </div>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-4 lg:flex-col lg:items-end">
                    <div className="grid gap-2 text-xs text-muted">
                      <InfoStack label="Size" value={formatBytes(d.file_size || 0)} />
                      <InfoStack label="Updated" value={formatRelative(d.completed_at || d.updated_at)} />
                      <InfoStack label="Route" value={d.requester_chat_id ? "Admin DM" : "Likes chat"} />
                    </div>
                    <button
                      onClick={() => retry.mutate(d.video_id)}
                      className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-bg/45 px-4 py-2 text-sm text-muted transition hover:border-accent/30 hover:text-text"
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
  const color = s === "completed" ? "bg-ok/20 text-ok"
    : s === "uploaded" ? "bg-ok/20 text-ok"
    : s === "upload_failed" ? "bg-err/20 text-err"
    : s === "uploading" ? "bg-accent/20 text-accent"
    : s === "failed" ? "bg-err/20 text-err"
    : s === "downloading" ? "bg-accent2/20 text-accent2"
    : "bg-bg/70 text-muted";
  return <span className={cn("inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-[10px] uppercase tracking-[0.24em]", color)}>{s}</span>;
}

function SourceBadge({ requesterChatId }: { requesterChatId?: number | null }) {
  const label = requesterChatId ? "admin link" : "auto like";
  const color = requesterChatId ? "bg-accent/20 text-accent" : "bg-accent2/20 text-accent2";
  return <span className={cn("inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-[10px] uppercase tracking-[0.24em]", color)}>{label}</span>;
}

function DeliveryBadge({ status, requesterChatId }: { status: string; requesterChatId?: number | null }) {
  if (status === "uploading") {
    return <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] text-accent">Uploading to Telegram…</span>;
  }
  if (status === "downloading") {
    return <span className="rounded-full border border-accent2/20 bg-accent2/10 px-3 py-1 text-[11px] text-accent2">Downloading with yt-dlp…</span>;
  }
  if (status === "uploaded") {
    return <span className="rounded-full border border-ok/20 bg-ok/10 px-3 py-1 text-[11px] text-ok">Uploaded to {requesterChatId ? "admin DM" : "likes chat"}</span>;
  }
  if (status === "upload_failed") {
    return <span className="rounded-full border border-err/20 bg-err/10 px-3 py-1 text-[11px] text-err">Telegram upload failed</span>;
  }
  if (status === "failed") {
    return <span className="rounded-full border border-err/20 bg-err/10 px-3 py-1 text-[11px] text-err">Download failed</span>;
  }
  if (status === "completed") {
    return <span className="rounded-full border border-border/60 bg-bg/40 px-3 py-1 text-[11px] text-muted">Download complete</span>;
  }
  return <span className="rounded-full border border-border/60 bg-bg/40 px-3 py-1 text-[11px] text-muted">Queued for processing</span>;
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
  tone = "neutral",
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "warm" | "cool" | "danger" | "neutral";
}) {
  const toneClass = tone === "warm"
    ? "bg-accent/20"
    : tone === "cool"
      ? "bg-accent2/20"
      : tone === "danger"
        ? "bg-err/20"
        : "bg-white/10";

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-border/70 bg-panel/60 p-4 shadow-panel">
      <div className={cn("absolute right-0 top-0 h-24 w-24 rounded-full blur-3xl", toneClass)} />
      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.28em] text-muted/85">{label}</div>
        <div className="mt-4 font-display text-4xl leading-none tabular-nums text-text">{value.toLocaleString()}</div>
        <div className="mt-2 text-sm leading-relaxed text-muted">{sub}</div>
      </div>
    </div>
  );
}

function MetaPill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "subtle" | "warning" }) {
  const toneClass = tone === "warning"
    ? "border-warn/30 bg-warn/10 text-warn"
    : tone === "subtle"
      ? "border-border/60 bg-bg/35 text-muted"
      : "border-border/60 bg-bg/45 text-text/90";

  return <span className={cn("rounded-full border px-3 py-1 text-[11px]", toneClass)}>{children}</span>;
}

function InfoStack({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/55 bg-bg/30 px-3 py-2 text-left lg:text-right">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted/80">{label}</div>
      <div className="mt-1 text-sm text-text">{value}</div>
    </div>
  );
}
