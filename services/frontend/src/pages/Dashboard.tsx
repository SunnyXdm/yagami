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
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-panel/60 border border-border rounded-xl p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={"text-3xl font-semibold mt-1 tabular-nums " + (accent ? "text-accent" : "")}>{value.toLocaleString()}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={"bg-panel/60 border border-border rounded-xl p-4 " + className}>
      <div className="text-xs uppercase tracking-wider text-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="flex justify-between text-sm py-1.5">
      <span className="text-muted">{label}</span>
      <span className={"tabular-nums " + (bad ? "text-err" : "")}>{value}</span>
    </div>
  );
}
