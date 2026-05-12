import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Search } from "lucide-react";
import { apiGet } from "../lib/api";
import { cn, formatRelative } from "../lib/utils";
import { Header } from "./Dashboard";

interface LogEntry {
  id: number;
  ts: string;
  service: string;
  level: string;
  message: string;
  fields?: any;
  error?: string | null;
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

  useEffect(() => {
    if (!follow) return;
    const es = new EventSource("/api/stream");
    const onLog = (ev: MessageEvent) => {
      try {
        const entry = JSON.parse(ev.data);
        if (typeof entry?.message === "string") {
          setLogs((prev) => prependLog(prev, entry, services, level, q));
        }
      } catch {}
    };
    ["logs.api-gateway", "logs.youtube-poller", "logs.downloader", "logs.telegram-client"].forEach((topic) => {
      es.addEventListener(topic, onLog as any);
    });
    return () => es.close();
  }, [follow, services.join(","), level, q]);

  const filtered = useMemo(() => {
    return logs.filter((entry) => {
      if (services.length && !services.includes(entry.service)) return false;
      if (level && entry.level !== level) return false;
      if (q && !entry.message.toLowerCase().includes(q.toLowerCase())) return false;
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
    <div className="space-y-6">
      <Header
        eyebrow="Structured traces"
        title="Runtime ledger"
        subtitle="Live logs from every service. Filters stay on the dark surface; the dense ledger moves onto paper for easier reading."
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
              "inline-flex h-9 items-center gap-2 rounded-[5px] border px-4 text-[13px] font-medium transition",
              follow ? "border-accent bg-accent text-ink" : "border-border bg-panel text-ash hover:text-text",
            )}
          >
            {follow ? <Pause size={14} /> : <Play size={14} />}
            {follow ? "Live" : "Paused"}
          </button>
        }
      />

      <div className="surface-dark flex flex-wrap gap-3 p-4 sm:p-5">
        <div className="flex h-11 items-center gap-2 rounded-[3px] border border-border bg-bg px-4">
          <Search size={14} className="text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search messages..."
            className="w-48 bg-transparent text-[15px] text-ash outline-none"
          />
        </div>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="h-11 rounded-[3px] border border-border bg-bg px-4 text-[15px] text-ash outline-none transition focus:ring-2 focus:ring-linkBlueSoft/30"
        >
          <option value="">all levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <div className="flex flex-wrap gap-2">
          {(allServices.data || []).map((service) => {
            const on = services.includes(service);
            return (
              <button
                key={service}
                onClick={() => setServices((prev) => (on ? prev.filter((value) => value !== service) : [...prev, service]))}
                className={cn(
                  "rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition",
                  on ? "border-hairline bg-light text-ink" : "border-border bg-panel text-ash hover:text-text",
                )}
              >
                {service}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={listRef} onScroll={handleScroll} className="surface-light max-h-[70vh] overflow-auto">
        <div className="font-mono text-[12px] text-ink">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-muted">No logs match these filters yet.</div>
          ) : (
            filtered.map((entry, index) => <LogRow key={entry.id ?? index} e={entry} />)
          )}
          {filtered.length > 0 && (
            <div className="border-t border-hairline px-4 py-3 text-center text-[11px] text-muted">
              {loadingMore ? "Loading older logs..." : hasMore ? "Scroll down for older logs." : "You have reached the oldest loaded log."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function prependLog(prev: LogEntry[], entry: LogEntry, services: string[], level: string, q: string) {
  if (services.length && !services.includes(entry.service)) return prev;
  if (level && entry.level !== level) return prev;
  if (q && !entry.message.toLowerCase().includes(q.toLowerCase())) return prev;
  if (prev.some((value) => value.id === entry.id)) return prev;
  const next = [entry, ...prev];
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
    info: "text-ink",
    warn: "text-warn",
    error: "text-err",
    debug: "text-muted",
  };

  const serviceColors: Record<string, string> = {
    "api-gateway": "text-linkBlue",
    "youtube-poller": "text-accent",
    downloader: "text-ok",
    "telegram-client": "text-slateSoft",
  };

  return (
    <div className="grid min-w-[760px] grid-cols-[110px_140px_72px_1fr] gap-4 border-b border-hairline px-4 py-3 hover:bg-paper/70">
      <span className="tabular-nums text-muted">{formatRelative(e.ts)}</span>
      <span className={serviceColors[e.service] || "text-muted"}>{e.service}</span>
      <span className={cn("uppercase tracking-[0.12em]", colors[e.level] || "")}>{e.level}</span>
      <span className={cn("whitespace-pre-wrap break-words", colors[e.level] || "text-ink")}>{e.message}</span>
    </div>
  );
}
