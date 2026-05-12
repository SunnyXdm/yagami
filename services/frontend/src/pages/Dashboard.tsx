import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { formatBytes } from "../lib/utils";

interface Stats {
  total_watched: number;
  total_liked: number;
  total_subscribed: number;
  total_downloaded: number;
  watched_today: number;
  liked_today: number;
  watched_last_7d: number;
  liked_last_7d: number;
  downloads_active: number;
  downloads_failed: number;
  bytes_downloaded: number;
  top_channels: { channel_id: string; channel_title: string; count: number }[];
}

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => apiGet<Stats>("stats"),
    refetchInterval: 10_000,
  });

  return (
    <div>
      <Header title="Dashboard" subtitle="Live overview of activity, downloads, and service health." />
      {isLoading || !data ? (
        <div className="text-muted">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Stat label="Likes" value={data.total_liked} sub={`+${data.liked_today} today`} accent />
            <Stat label="Watched" value={data.total_watched} sub={`+${data.watched_today} today`} />
            <Stat label="Subscriptions" value={data.total_subscribed} />
            <Stat label="Downloaded" value={data.total_downloaded} sub={formatBytes(data.bytes_downloaded)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="This week">
              <Row label="Likes" value={data.liked_last_7d} />
              <Row label="Watches" value={data.watched_last_7d} />
              <Row label="Active downloads" value={data.downloads_active} />
              <Row label="Failed downloads" value={data.downloads_failed} bad={data.downloads_failed > 0} />
            </Card>
            <Card className="lg:col-span-2" title="Top channels">
              {(data.top_channels?.length ?? 0) === 0 ? (
                <div className="text-muted text-sm">No activity in the last 7 days.</div>
              ) : (
                <div className="space-y-2">
                  {data.top_channels.map((c) => {
                    const max = Math.max(...(data.top_channels || []).map((x) => x.count));
                    return (
                      <div key={c.channel_id}>
                        <div className="flex justify-between text-sm">
                          <span className="truncate">{c.channel_title}</span>
                          <span className="text-muted tabular-nums">{c.count}</span>
                        </div>
                        <div className="h-1 bg-bg rounded">
                          <div
                            className="h-1 bg-gradient-to-r from-accent to-accent2 rounded"
                            style={{ width: `${(c.count / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-[32px] border border-border/70 bg-panel/55 px-5 py-6 shadow-panel sm:px-6 lg:px-8">
      <div className="absolute inset-y-0 right-0 w-52 bg-[radial-gradient(circle_at_center,rgba(84,146,255,.18),transparent_72%)]" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="text-[10px] uppercase tracking-[0.36em] text-muted/80">Operations deck</div>
          <h1 className="mt-3 font-display text-4xl leading-[0.95] tracking-tight sm:text-5xl">{title}</h1>
          {subtitle && <div className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">{subtitle}</div>}
        </div>
        <div>
          {right ?? (
            <div className="inline-flex items-center gap-3 rounded-full border border-border/70 bg-bg/45 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-muted">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              Live telemetry
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-[24px] border border-border/70 bg-panel/60 p-4 shadow-panel">
      <div className={"absolute right-0 top-0 h-24 w-24 rounded-full blur-3xl " + (accent ? "bg-accent/20" : "bg-accent2/18")} />
      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.28em] text-muted/85">{label}</div>
        <div className={"mt-4 font-display text-4xl leading-none tabular-nums " + (accent ? "text-accent" : "text-text")}>{value.toLocaleString()}</div>
        {sub && <div className="mt-2 text-sm text-muted">{sub}</div>}
      </div>
    </div>
  );
}

export function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={"rounded-[24px] border border-border/70 bg-panel/60 p-5 shadow-panel " + className}>
      <div className="mb-4 text-[10px] uppercase tracking-[0.32em] text-muted/85">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border/40 py-2 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={"tabular-nums font-medium " + (bad ? "text-err" : "text-text")}>{value}</span>
    </div>
  );
}
