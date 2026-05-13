import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Search } from "lucide-react";
import { apiGet, apiStream } from "../lib/api";
import { cn, formatRelative, useNow } from "../lib/utils";
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
  const nextLiveId = useRef(-1);
  const now = useNow();

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
    const es = apiStream();
    const onLog = (ev: MessageEvent) => {
      try {
        const raw = JSON.parse(ev.data);
        const entry: LogEntry = {
          id: typeof raw?.id === "number" && raw.id > 0 ? raw.id : nextLiveId.current--,
          ts: typeof raw?.ts === "string" ? raw.ts : new Date().toISOString(),
          service: typeof raw?.service === "string" ? raw.service : "unknown",
          level: typeof raw?.level === "string" ? raw.level : "info",
          message: typeof raw?.message === "string" ? raw.message : "",
          fields: raw?.fields,
          error: typeof raw?.error === "string" ? raw.error : null,
        };
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
    <div className="space-y-5">
      <Header
        eyebrow="Logs"
        title="Log viewer"
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
              "inline-flex h-9 items-center gap-2 rounded-[8px] border px-4 text-[13px] font-medium transition",
              follow ? "border-white/12 bg-elevated text-text" : "border-border bg-panel text-body hover:text-text",
            )}
          >
            {follow ? <Pause size={14} /> : <Play size={14} />}
            {follow ? "Live" : "Paused"}
          </button>
        }
      />

      <div className="surface-dark flex flex-wrap gap-3 p-3 sm:p-4">
        <div className="flex h-11 items-center gap-2 rounded-[8px] border border-border bg-card px-4">
          <Search size={14} className="text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search messages..."
            className="w-48 bg-transparent text-[15px] text-text outline-none"
          />
        </div>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="h-11 rounded-[8px] border border-border bg-card px-4 text-[15px] text-text outline-none transition focus:ring-2 focus:ring-white/10"
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
                  "rounded-[8px] border px-4 py-2 text-[12px] transition",
                  on ? "border-white/12 bg-elevated text-text" : "border-border bg-panel text-body hover:text-text",
                )}
              >
                {service}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={listRef} onScroll={handleScroll} className="command-card max-h-[72vh] overflow-auto">
        <div className="text-[12px] text-body">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-muted">No logs match these filters yet.</div>
          ) : (
            filtered.map((entry) => <LogRow key={logIdentity(entry)} e={entry} now={now} />)
          )}
          {filtered.length > 0 && (
            <div className="border-t border-border px-4 py-3 text-center text-[11px] text-muted">
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
  const incomingKey = logIdentity(entry);
  if (prev.some((value) => logIdentity(value) === incomingKey)) return prev;
  const next = [entry, ...prev];
  if (next.length > 2000) next.length = 2000;
  return next;
}

function logIdentity(entry: LogEntry) {
  if (typeof entry.id === "number" && entry.id > 0) return `id:${entry.id}`;
  return `live:${entry.ts}:${entry.service}:${entry.level}:${entry.message}`;
}

function appendOlder(prev: LogEntry[], older: LogEntry[]) {
  if (older.length === 0) return prev;
  const seen = new Set(prev.map(logIdentity));
  const next = prev.slice();
  for (const entry of older) {
    const key = logIdentity(entry);
    if (!seen.has(key)) {
      next.push(entry);
      seen.add(key);
    }
  }
  return next;
}

function LogRow({ e, now }: { e: LogEntry; now: number }) {
  const colors: Record<string, string> = {
    info: "text-text",
    warn: "text-accentYellow",
    error: "text-accentRed",
    debug: "text-muted",
  };

  const serviceColors: Record<string, string> = {
    "api-gateway": "text-accentBlue",
    "youtube-poller": "text-accentYellow",
    downloader: "text-accentGreen",
    "telegram-client": "text-accentRed",
  };

  return (
    <div className="grid min-w-[760px] grid-cols-[110px_140px_72px_1fr] gap-4 border-b border-border px-4 py-2.5 hover:bg-card/70">
      <span className="tabular-nums text-muted">{formatRelative(e.ts, now)}</span>
      <span className={serviceColors[e.service] || "text-muted"}>{e.service}</span>
      <span className={cn("uppercase tracking-[0.12em]", colors[e.level] || "")}>{e.level}</span>
      <span className={cn("whitespace-pre-wrap break-words", colors[e.level] || "text-text")}>{e.message}</span>
    </div>
  );
}
