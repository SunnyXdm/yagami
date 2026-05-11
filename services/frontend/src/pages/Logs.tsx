import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { Header } from "./Dashboard";
import { cn, formatRelative } from "../lib/utils";
import { Pause, Play, Search } from "lucide-react";

interface LogEntry {
  id: number; ts: string; service: string; level: string;
  message: string; fields?: any; error?: string | null;
}

const PAGE_SIZE = 100;
const LOAD_MORE_OFFSET = 160;

export function LogsPage() {
  const [services, setServices] = useState<string[]>([]);
  const [level, setLevel] = useState<string>("");
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const allServices = useQuery({
    queryKey: ["log-services"],
    queryFn: () => apiGet<string[]>("logs/services"),
    refetchInterval: 30_000,
  });

  const initial = useQuery({
    queryKey: ["logs", services, level, q],
    queryFn: () => {
      const u = new URLSearchParams();
      if (services.length === 1) u.set("service", services[0]);
      if (level) u.set("level", level);
      if (q) u.set("q", q);
      u.set("limit", String(PAGE_SIZE));
      return apiGet<LogEntry[]>(`logs?${u.toString()}`);
    },
  });

  useEffect(() => {
    if (!initial.data) return;
    setLogs(initial.data);
    setHasMore(initial.data.length === PAGE_SIZE);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [initial.data]);

  async function loadOlder() {
    if (loadingMore || !hasMore || logs.length === 0) return;
    const oldest = logs[logs.length - 1];
    if (!oldest) return;

    setLoadingMore(true);
    try {
      const u = new URLSearchParams();
      if (services.length === 1) u.set("service", services[0]);
      if (level) u.set("level", level);
      if (q) u.set("q", q);
      u.set("limit", String(PAGE_SIZE));
      u.set("after_id", String(oldest.id));

      const older = await apiGet<LogEntry[]>(`logs?${u.toString()}`);
      setLogs((prev) => appendOlder(prev, older));
      setHasMore(older.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  // SSE subscribe
  useEffect(() => {
    if (!follow) return;
    const es = new EventSource("/api/stream");
    const onLog = (ev: MessageEvent) => {
      try {
        const e = JSON.parse(ev.data);
        // logs.<service> arrives via systemBus too; but our SSE streams events.
        // The api-gateway also forwards logs over SSE under topic logs.<svc>.
        if (typeof e?.message === "string") {
          setLogs((prev) => prependLog(prev, e, services, level, q));
        }
      } catch {}
    };
    ["logs.api-gateway", "logs.youtube-poller", "logs.downloader", "logs.telegram-client"]
      .forEach((t) => es.addEventListener(t, onLog as any));
    return () => es.close();
  }, [follow, services.join(","), level, q]);

  const filtered = useMemo(() => {
    return logs.filter((e) => {
      if (services.length && !services.includes(e.service)) return false;
      if (level && e.level !== level) return false;
      if (q && !e.message.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [logs, services.join(","), level, q]);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const next = event.currentTarget;
    if (follow && next.scrollTop > 48) {
      setFollow(false);
    }
    if (next.scrollTop + next.clientHeight >= next.scrollHeight - LOAD_MORE_OFFSET) {
      void loadOlder();
    }
  }

  return (
    <div>
      <Header
        title="Logs"
        subtitle="Live, structured logs from every service. Filter by service, level, or text."
        right={
          <button
            onClick={() => {
              setFollow((value) => {
                const next = !value;
                if (next && listRef.current) {
                  listRef.current.scrollTop = 0;
                }
                return next;
              });
            }}
            className={cn(
              "px-3 py-1.5 text-xs rounded-lg border border-border flex items-center gap-2",
              follow ? "bg-accent text-white" : "bg-panel"
            )}
          >
            {follow ? <Pause size={14} /> : <Play size={14} />}
            {follow ? "Live" : "Paused"}
          </button>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2 bg-panel/60 border border-border rounded-lg px-2.5 py-1.5">
          <Search size={14} className="text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search messages…"
            className="bg-transparent text-sm w-48 focus:outline-none"
          />
        </div>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="bg-panel/60 border border-border rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="">all levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <div className="flex flex-wrap gap-1">
          {(allServices.data || []).map((s) => {
            const on = services.includes(s);
            return (
              <button
                key={s}
                onClick={() => setServices((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-lg border transition",
                  on ? "bg-accent2/20 border-accent2 text-text" : "bg-panel/60 border-border text-muted hover:text-text"
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="bg-panel/40 border border-border rounded-xl overflow-auto max-h-[70vh]"
      >
        <div className="font-mono text-xs">
          {filtered.length === 0 ? (
            <div className="p-6 text-muted text-center">No logs match these filters yet.</div>
          ) : (
            filtered.map((e, i) => <LogRow key={e.id ?? i} e={e} />)
          )}
          {filtered.length > 0 && (
            <div className="px-4 py-3 text-[11px] text-muted border-t border-border/30 text-center">
              {loadingMore ? "Loading older logs..." : hasMore ? "Scroll down for older logs." : "You have reached the oldest loaded log."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function prependLog(prev: LogEntry[], e: LogEntry, services: string[], level: string, q: string) {
  if (services.length && !services.includes(e.service)) return prev;
  if (level && e.level !== level) return prev;
  if (q && !e.message.toLowerCase().includes(q.toLowerCase())) return prev;
  if (prev.some((entry) => entry.id === e.id)) return prev;
  const next = [e, ...prev];
  if (next.length > 2000) next.length = 2000;
  return next;
}

function appendOlder(prev: LogEntry[], older: LogEntry[]) {
  if (older.length === 0) return prev;
  const seen = new Set(prev.map((entry) => entry.id));
  const next = prev.slice();
  for (const entry of older) {
    if (!seen.has(entry.id)) {
      next.push(entry);
      seen.add(entry.id);
    }
  }
  return next;
}

function LogRow({ e }: { e: LogEntry }) {
  const colors: Record<string, string> = {
    info: "text-text",
    warn: "text-warn",
    error: "text-err",
    debug: "text-muted",
  };
  const svcColors: Record<string, string> = {
    "api-gateway": "text-accent2",
    "youtube-poller": "text-accent",
    "downloader": "text-ok",
    "telegram-client": "text-warn",
  };
  return (
    <div className="min-w-[720px] px-4 py-1 grid grid-cols-[110px_140px_60px_1fr] gap-3 hover:bg-bg/40 border-b border-border/30">
      <span className="text-muted tabular-nums">{formatRelative(e.ts)}</span>
      <span className={svcColors[e.service] || "text-muted"}>{e.service}</span>
      <span className={cn("uppercase text-[10px] font-bold tracking-wider", colors[e.level] || "")}>{e.level}</span>
      <span className={cn("whitespace-pre-wrap break-words", colors[e.level] || "text-text")}>{e.message}</span>
    </div>
  );
}
