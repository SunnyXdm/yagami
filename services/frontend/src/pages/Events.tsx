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
        eyebrow="Watched, liked, subscribed"
        title="Activity archive"
        subtitle="Likes, watches, and subscription changes in reverse chronological order. The archive lives on the light surface so dense reading stays easy."
      />

      <div className="surface-dark flex flex-wrap gap-3 p-4 sm:p-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by video or channel title..."
          className="input-light w-full sm:w-80"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-11 rounded-[3px] border border-hairline bg-light px-4 text-[16px] text-ink outline-none transition focus:ring-2 focus:ring-linkBlue/30"
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
          <div className="surface-paper col-span-full px-8 py-12 text-center text-[15px] text-muted">
            No activity yet. Once the YouTube poller runs, your likes and watches will land here.
          </div>
        )}

        {(data || []).map((e) => {
          const href = eventHref(e);
          const content = (
            <>
              {e.thumbnail_url ? (
                <img src={e.thumbnail_url} className="w-full aspect-video object-cover rounded-[6px] flex-shrink-0 sm:w-40" alt="" />
              ) : (
                <div className="w-full aspect-video rounded-[6px] bg-paper flex-shrink-0 sm:w-40" />
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <TypeBadge t={e.event_type} />
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    {formatRelative(e.created_at)}
                  </span>
                </div>
                <div className="line-clamp-2 text-[24px] leading-[1.05] tracking-[-0.02em] text-ink transition group-hover:text-accent">
                  {eventTitle(e)}
                </div>
                <div className="mt-2 truncate text-[15px] text-muted">{eventSubtitle(e)}</div>
              </div>
            </>
          );

          const cardClass = "grid gap-4 rounded-[12px] border border-hairline bg-light p-4 text-ink shadow-softdrop sm:grid-cols-[160px_1fr] sm:items-start";

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
    return e.channel_title || e.title || e.channel_id || "(untitled)";
  }
  return e.title || e.channel_title || e.channel_id || "(untitled)";
}

function eventSubtitle(e: Event) {
  if (e.event_type === "subscribe" || e.event_type === "unsubscribe") {
    return e.channel_id || "—";
  }
  return e.channel_title || e.channel_id || "—";
}

function TypeBadge({ t }: { t: string }) {
  const colors: Record<string, string> = {
    like: "border-accent/35 bg-accent/12 text-ink",
    watch: "border-linkBlue/20 bg-linkBlue/5 text-linkBlue",
    subscribe: "border-ok/30 bg-ok/10 text-ink",
    unsubscribe: "border-err/30 bg-err/10 text-ink",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em]",
        colors[t] || "border-hairline bg-paper text-ink",
      )}
    >
      {t}
    </span>
  );
}
