import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { Header } from "./Dashboard";
import { cn, formatRelative } from "../lib/utils";
import { Pause, Play, Search } from "lucide-react";

interface LogEntry {
  id: number; ts: string; service: string; level: string;
  message: string; fields?: any; error?: string | null;
}

export function LogsPage() {
  const [services, setServices] = useState<string[]>([]);
  const [level, setLevel] = useState<string>("");
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const [tail, setTail] = useState<LogEntry[]>([]);

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
      u.set("limit", "200");
      return apiGet<LogEntry[]>(`logs?${u.toString()}`);
    },
  });

  useEffect(() => {
    if (initial.data) setTail(initial.data.slice().reverse());
  }, [initial.data]);

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
          setTail((prev) => filterAndPush(prev, e, services, level, q));
        }
      } catch {}
    };
    ["logs.api-gateway", "logs.youtube-poller", "logs.downloader", "logs.telegram-client"]
      .forEach((t) => es.addEventListener(t, onLog as any));
    return () => es.close();
  }, [follow, services.join(","), level, q]);

  const filtered = useMemo(() => {
    return tail.filter((e) => {
      if (services.length && !services.includes(e.service)) return false;
      if (level && e.level !== level) return false;
      if (q && !e.message.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [tail, services.join(","), level, q]);

  return (
    <div>
      <Header
        title="Logs"
        subtitle="Live, structured logs from every service. Filter by service, level, or text."
        right={
          <button
            onClick={() => setFollow((v) => !v)}
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

      <div className="bg-panel/40 border border-border rounded-xl overflow-x-auto">
        <div className="font-mono text-xs">
          {filtered.length === 0 ? (
            <div className="p-6 text-muted text-center">No logs match these filters yet.</div>
          ) : (
            filtered.slice(-500).map((e, i) => <LogRow key={e.id ?? i} e={e} />)
          )}
        </div>
      </div>
    </div>
  );
}

function filterAndPush(prev: LogEntry[], e: LogEntry, services: string[], level: string, q: string) {
  if (services.length && !services.includes(e.service)) return prev;
  if (level && e.level !== level) return prev;
  if (q && !e.message.toLowerCase().includes(q.toLowerCase())) return prev;
  const next = [...prev, e];
  if (next.length > 1000) next.splice(0, next.length - 1000);
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
