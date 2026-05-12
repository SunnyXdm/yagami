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
    <div className="space-y-8">
      <Header
        eyebrow="Editorial control"
        title="Signal overview"
        subtitle="Live overview of activity, downloads, and service health. Dark surfaces carry the live voice; the light panel holds the denser reading surface."
      />
      {isLoading || !data ? (
        <div className="surface-dark px-6 py-8 text-[15px] text-ash">Loading...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Stat label="Liked videos" value={data.total_liked} sub={`+${data.liked_today} today`} tone="brand" />
            <Stat label="Watched" value={data.total_watched} sub={`+${data.watched_today} today`} tone="dark" />
            <Stat label="Subscriptions" value={data.total_subscribed} tone="light" />
            <Stat label="Downloaded" value={data.total_downloaded} sub={formatBytes(data.bytes_downloaded)} tone="dark" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.28fr)]">
            <Card title="This week" tone="dark">
              <Row label="Likes" value={data.liked_last_7d} />
              <Row label="Watches" value={data.watched_last_7d} />
              <Row label="Active downloads" value={data.downloads_active} />
              <Row label="Failed downloads" value={data.downloads_failed} bad={data.downloads_failed > 0} />
            </Card>
            <Card className="xl:min-h-full" title="Top channels" tone="light">
              {(data.top_channels?.length ?? 0) === 0 ? (
                <div className="text-[15px] text-muted">No activity in the last 7 days.</div>
              ) : (
                <div className="space-y-5">
                  {data.top_channels.map((c) => {
                    const max = Math.max(...(data.top_channels || []).map((x) => x.count), 1);
                    return (
                      <div key={c.channel_id} className="space-y-2 border-b border-hairline pb-5 last:border-b-0 last:pb-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="truncate text-[24px] leading-[1.05] tracking-[-0.02em] text-ink">{c.channel_title}</div>
                            <div className="mono-caps mt-2">{c.channel_id}</div>
                          </div>
                          <span className="font-display text-[36px] leading-none tracking-[-0.03em] text-ink tabular-nums">{c.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-paper">
                          <div
                            className="h-1.5 rounded-full bg-ink"
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
  eyebrow = "Operations",
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
    <header className="mb-10 border-b border-border pb-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-4xl">
          <div className="mono-eyebrow">{eyebrow}</div>
          <h1 className="editorial-display mt-5 text-[clamp(3.5rem,8vw,6.25rem)]">{title}</h1>
          {subtitle && <p className="mt-5 max-w-2xl text-[18px] leading-[1.5] text-ash">{subtitle}</p>}
        </div>
        <div className="flex justify-start lg:justify-end">
          {right ?? (
            <div className="inline-flex items-center gap-3 rounded-full border border-border bg-panel px-4 py-3">
              <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
              <span className="mono-caps text-ash">Live telemetry</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "dark",
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "dark" | "light" | "brand";
}) {
  const className = tone === "brand"
    ? "rounded-[12px] border border-accent bg-accent p-5 text-ink"
    : tone === "light"
      ? "surface-light p-5"
      : "surface-dark p-5";

  return (
    <div className={className}>
      <div className="mono-caps">{label}</div>
      <div className={cn(
        "mt-5 font-display text-[48px] leading-none tracking-[-0.035em] tabular-nums",
        tone === "dark" ? "text-text" : "text-ink"
      )}>
        {value.toLocaleString()}
      </div>
      {sub && (
        <div className={cn("mt-3 text-[15px] leading-[1.5]", tone === "dark" ? "text-ash" : "text-muted")}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
  tone = "dark",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  tone?: "dark" | "light" | "paper";
}) {
  return (
    <div
      className={cn(
        tone === "light" ? "surface-light" : tone === "paper" ? "surface-paper" : "surface-dark",
        "p-6",
        className,
      )}
    >
      <div className="mono-caps mb-6">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border py-3 text-[15px] leading-[1.5] last:border-b-0">
      <span className="text-ash">{label}</span>
      <span className={cn("tabular-nums", bad ? "text-err" : "text-text")}>{value}</span>
    </div>
  );
}
