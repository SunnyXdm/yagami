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
  up:        "bg-accentGreen",
  degraded:  "bg-accentYellow",
  starting:  "bg-accentBlue animate-pulse",
  down:      "bg-accentRed",
};

export function ServiceHealthDot() {
  const { data } = useQuery({
    queryKey: ["heartbeats"],
    queryFn: () => apiGet<Hb[]>("heartbeats"),
    refetchInterval: 5_000,
  });

  return (
    <div className="flex flex-wrap gap-2">
      {SERVICES.map((s) => {
        const c = classify(data?.find((h) => h.service === s));
        return (
          <div
            key={s}
            className="inline-flex items-center gap-2 rounded-[8px] border border-border bg-panel px-3 py-2 text-[12px]"
            title={c.label}
          >
            <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dotColor[c.state])} />
            <span className="text-body">{LABELS[s]}</span>
            <span className="tabular-nums text-muted">{c.label}</span>
          </div>
        );
      })}
    </div>
  );
}
