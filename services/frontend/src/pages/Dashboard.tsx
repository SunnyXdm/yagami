import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { cn, formatBytes } from "../lib/utils";

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
    <div className="space-y-5">
      <Header
        eyebrow="Overview"
        title="Overview"
      />
      {isLoading || !data ? (
        <div className="surface-dark px-6 py-8 text-[15px] text-body">Loading...</div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Stat label="Liked videos" value={data.total_liked} sub={`+${data.liked_today} today`} accent="yellow" />
            <Stat label="Watched" value={data.total_watched} sub={`+${data.watched_today} today`} accent="blue" />
            <Stat label="Subscriptions" value={data.total_subscribed} accent="green" />
            <Stat label="Downloaded" value={data.total_downloaded} sub={formatBytes(data.bytes_downloaded)} accent="red" />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.28fr)]">
            <Card title="This week" tone="surface" hint="Recent totals">
              <Row label="Likes" value={data.liked_last_7d} />
              <Row label="Watches" value={data.watched_last_7d} />
              <Row label="Active downloads" value={data.downloads_active} />
              <Row label="Failed downloads" value={data.downloads_failed} bad={data.downloads_failed > 0} />
            </Card>
            <Card className="xl:min-h-full" title="Top channels" tone="elevated" hint="Last 7 days">
              {(data.top_channels?.length ?? 0) === 0 ? (
                <div className="text-[15px] text-body">No activity in the last 7 days.</div>
              ) : (
                <div className="space-y-5">
                  {data.top_channels.map((c) => {
                    const max = Math.max(...(data.top_channels || []).map((x) => x.count), 1);
                    return (
                      <div key={c.channel_id} className="rounded-[8px] border border-border bg-card p-3 last:border-border">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex items-start gap-3">
                            <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-[7px] border border-border bg-panel text-[13px] font-medium text-text">
                              {c.channel_title?.slice(0, 1).toUpperCase() || "Y"}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-[15px] font-medium leading-[1.4] text-text">{c.channel_title}</div>
                              <div className="mt-1 text-[13px] text-muted">{c.channel_id}</div>
                            </div>
                          </div>
                          <span className="text-[22px] font-semibold leading-none text-text tabular-nums">{c.count}</span>
                        </div>
                        <div className="mt-3 h-1.5 rounded-full bg-panel">
                          <div
                            className="h-1.5 rounded-full bg-white"
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

export function Header({
  eyebrow = "Overview",
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{eyebrow}</div>
          <h1 className="mt-1.5 text-[22px] font-semibold leading-[1.2] text-text">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] leading-[1.6] text-body">{subtitle}</p>}
        </div>
        {right && <div className="flex-shrink-0 pt-0.5">{right}</div>}
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "blue",
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: "blue" | "green" | "red" | "yellow";
}) {
  const accentClass = accent === "green"
    ? "bg-accentGreen"
    : accent === "red"
      ? "bg-accentRed"
      : accent === "yellow"
        ? "bg-accentYellow"
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
      {sub && <div className="mt-1 text-[13px] leading-[1.5] text-body">{sub}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
  tone = "surface",
  hint,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  tone?: "surface" | "elevated" | "card";
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[8px] border border-border",
        tone === "elevated" ? "bg-elevated" : tone === "card" ? "bg-card" : "bg-panel",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-[14px] font-medium text-text">{title}</div>
        {hint && <div className="text-[13px] text-muted">{hint}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Row({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.5 text-[14px] leading-[1.5] last:border-b-0">
      <span className="text-body">{label}</span>
      <span className={cn("tabular-nums font-medium", bad ? "text-accentRed" : "text-text")}>{value}</span>
    </div>
  );
}
