import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { Header } from "./Dashboard";
import { cn, formatRelative } from "../lib/utils";

interface Event {
  id: number;
  event_type: string;
  video_id: string | null;
  channel_id: string | null;
  title: string | null;
  channel_title: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export function EventsPage() {
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["events", type, q],
    queryFn: () => {
      const u = new URLSearchParams();
      if (type) u.set("type", type);
      if (q) u.set("q", q);
      u.set("limit", "100");
      return apiGet<Event[]>(`events?${u.toString()}`);
    },
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-6">
      <Header
        eyebrow="Activity"
        title="Event log"
      />

      <div className="surface-dark flex flex-wrap gap-3 p-4 sm:p-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by video or channel title..."
          className="input-dark w-full sm:w-80"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-11 rounded-[8px] border border-border bg-card px-4 text-[15px] text-text outline-none transition focus:ring-2 focus:ring-white/10"
        >
          <option value="">all events</option>
          <option value="like">likes</option>
          <option value="watch">watches</option>
          <option value="subscribe">subscribed</option>
          <option value="unsubscribe">unsubscribed</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(data?.length ?? 0) === 0 && (
          <div className="surface-dark col-span-full px-8 py-12 text-center text-[15px] text-body">
            No activity yet. Once the YouTube poller runs, your likes and watches will land here.
          </div>
        )}

        {(data || []).map((e) => {
          const href = eventHref(e);
          const content = (
            <>
              {e.thumbnail_url ? (
                <img src={e.thumbnail_url} className="w-full aspect-video object-cover rounded-[10px] flex-shrink-0 sm:w-40" alt="" />
              ) : (
                <div className="w-full aspect-video rounded-[10px] bg-card flex-shrink-0 sm:w-40" />
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <TypeBadge t={e.event_type} />
                  <span className="text-[12px] text-muted">
                    {formatRelative(e.created_at)}
                  </span>
                </div>
                <div className="line-clamp-2 text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-text transition group-hover:text-white">
                  {eventTitle(e)}
                </div>
                <div className="mt-2 truncate text-[15px] text-body">{eventSubtitle(e)}</div>
              </div>
            </>
          );

          const cardClass = "grid gap-4 rounded-[12px] border border-border bg-panel p-4 text-text sm:grid-cols-[160px_1fr] sm:items-start";

          if (!href) {
            return (
              <div key={e.id} className={cardClass}>
                {content}
              </div>
            );
          }

          return (
            <a key={e.id} href={href} target="_blank" rel="noreferrer" className={cn(cardClass, "group transition hover:border-accent/40")}>
              {content}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function eventHref(e: Event) {
  if (e.video_id) {
    return `https://www.youtube.com/watch?v=${e.video_id}`;
  }
  if (e.channel_id) {
    return `https://www.youtube.com/channel/${e.channel_id}`;
  }
  return null;
}

function eventTitle(e: Event) {
  if (e.event_type === "subscribe" || e.event_type === "unsubscribe") {
    return e.channel_title || e.title || "(untitled)";
  }
  return e.title || e.channel_title || "(untitled)";
}

function eventSubtitle(e: Event) {
  if (e.event_type === "subscribe" || e.event_type === "unsubscribe") {
    return e.channel_id || "—";
  }
  return e.channel_title || e.channel_id || "—";
}

function TypeBadge({ t }: { t: string }) {
  const dots: Record<string, string> = {
    like: "bg-accentYellow",
    watch: "bg-accentBlue",
    subscribe: "bg-accentGreen",
    unsubscribe: "bg-accentRed",
  };
  return (
    <span className="inline-flex items-center gap-2 rounded-[8px] border border-border bg-card px-3 py-1.5 text-[12px] text-body">
      <span className={cn("h-2 w-2 rounded-full", dots[t] || "bg-white/45")} />
      {t}
    </span>
  );
}
