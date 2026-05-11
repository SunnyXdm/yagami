import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { cn } from "../lib/utils";

interface Hb {
  service: string;
  status: string;
  seconds_ago: number | null;
}

const SERVICES = ["api-gateway", "youtube-poller", "downloader", "telegram-client"];
const LABELS: Record<string, string> = {
  "api-gateway": "API gateway",
  "youtube-poller": "YouTube poller",
  "downloader": "Downloader",
  "telegram-client": "Telegram bot",
};

type Health = "up" | "degraded" | "starting" | "down";

function classify(hb?: Hb): { state: Health; label: string } {
  if (!hb || hb.seconds_ago == null) return { state: "down", label: "no signal" };
  if (hb.seconds_ago > 90) return { state: "down", label: `${hb.seconds_ago}s ago` };
  if (hb.status === "starting") return { state: "starting", label: "starting" };
  if (hb.status === "degraded") return { state: "degraded", label: "degraded" };
  return { state: "up", label: `${hb.seconds_ago}s` };
}

const dotColor: Record<Health, string> = {
  up:        "bg-ok shadow-[0_0_6px_rgba(34,197,94,.7)]",
  degraded:  "bg-warn shadow-[0_0_6px_rgba(245,158,11,.7)]",
  starting:  "bg-accent2 shadow-[0_0_6px_rgba(124,92,255,.7)] animate-pulse",
  down:      "bg-err",
};

export function ServiceHealthDot() {
  const { data } = useQuery({
    queryKey: ["heartbeats"],
    queryFn: () => apiGet<Hb[]>("heartbeats"),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-1.5">
      {SERVICES.map((s) => {
        const c = classify(data?.find((h) => h.service === s));
        return (
          <div key={s} className="flex items-center gap-2 text-[11px]" title={c.label}>
            <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", dotColor[c.state])} />
            <span className="text-text/80 truncate">{LABELS[s]}</span>
            <span className="ml-auto tabular-nums text-muted">{c.label}</span>
          </div>
        );
      })}
    </div>
  );
}
