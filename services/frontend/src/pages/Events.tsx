import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { Header } from "./Dashboard";
import { formatRelative, cn } from "../lib/utils";

interface Event {
  id: number; event_type: string; video_id: string | null; channel_id: string | null;
  title: string | null; channel_title: string | null; thumbnail_url: string | null;
  duration_seconds: number | null; created_at: string;
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
    <div>
      <Header title="Activity" subtitle="Likes, watches, and subscription changes — newest first." />
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by video or channel title…"
          className="bg-panel/60 border border-border rounded-lg px-3 py-1.5 text-sm w-full sm:w-64"
        />
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="bg-panel/60 border border-border rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">all events</option>
          <option value="like">likes</option>
          <option value="watch">watches</option>
          <option value="subscribe">subscribed</option>
          <option value="unsubscribe">unsubscribed</option>
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(data?.length ?? 0) === 0 && (
          <div className="col-span-full p-8 text-muted text-center bg-panel/40 border border-border rounded-xl">
            No activity yet. Once the YouTube poller runs, your likes and watches will land here.
          </div>
        )}
        {(data || []).map((e) => {
          const href = eventHref(e);
          const content = (
            <>
              {e.thumbnail_url ? (
                <img src={e.thumbnail_url} className="w-32 aspect-video object-cover rounded-md flex-shrink-0" alt="" />
              ) : (
                <div className="w-32 aspect-video bg-bg rounded-md flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <TypeBadge t={e.event_type} />
                  <span className="text-xs text-muted">{formatRelative(e.created_at)}</span>
                </div>
                <div className="text-sm font-medium line-clamp-2 group-hover:text-accent2 transition">{eventTitle(e)}</div>
                <div className="text-xs text-muted truncate mt-1">{eventSubtitle(e)}</div>
              </div>
            </>
          );

          if (!href) {
            return (
              <div key={e.id} className="flex gap-3 bg-panel/60 border border-border rounded-xl p-3">
                {content}
              </div>
            );
          }

          return (
            <a key={e.id}
               href={href}
               target="_blank" rel="noreferrer"
               className="flex gap-3 bg-panel/60 border border-border rounded-xl p-3 hover:border-accent2/60 transition group">
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
    like: "bg-accent/20 text-accent",
    watch: "bg-accent2/20 text-accent2",
    subscribe: "bg-ok/20 text-ok",
    unsubscribe: "bg-err/20 text-err",
  };
  return <span className={cn("text-[10px] px-2 py-0.5 rounded uppercase tracking-wide font-bold", colors[t] || "bg-bg text-muted")}>{t}</span>;
}
