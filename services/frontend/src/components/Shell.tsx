import {
  Activity, Settings, Terminal, Download, LogOut, Heart,
} from "lucide-react";
import type { Page } from "../App";
import { apiPost } from "../lib/api";
import { cn } from "../lib/utils";
import { Logo } from "../pages/Login";
import { ServiceHealthDot } from "./ServiceHealthDot";

interface User { id: string; username: string }

export function Shell({
  user, page, onPage, onLogout, children,
}: {
  user: User;
  page: Page;
  onPage: (p: Page) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const nav: { id: Page; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: Activity },
    { id: "events", label: "Activity", icon: Heart },
    { id: "downloads", label: "Downloads", icon: Download },
    { id: "logs", label: "Logs", icon: Terminal },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[290px_1fr]">
      <aside className="relative overflow-hidden border-b border-border/80 bg-panel/75 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(255,106,66,.24),transparent_58%)]" />
        <div className="absolute -left-16 top-52 h-40 w-40 rounded-full bg-accent2/10 blur-3xl" />
        <div className="relative flex h-full flex-col px-4 py-4 lg:px-5 lg:py-6">
          <div className="rounded-[28px] border border-border/70 bg-bg/45 p-4 shadow-panel">
            <div className="flex items-center gap-3">
              <Logo />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.34em] text-muted/85">Signal room</div>
                <div className="font-display text-[30px] leading-none tracking-tight text-text">Yagami</div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              A live command deck for YouTube activity, delivery lanes, and service health.
            </p>
          </div>

          <div className="mt-4 rounded-[26px] border border-border/70 bg-bg/35 p-2">
            <nav className="flex gap-2 overflow-x-auto lg:block lg:space-y-2">
              {nav.map((n) => {
                const Icon = n.icon;
                const active = page === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => onPage(n.id)}
                    className={cn(
                      "group flex min-w-[136px] items-center gap-3 rounded-2xl border px-3 py-3 text-left text-sm transition lg:w-full",
                      active
                        ? "border-accent/35 bg-[linear-gradient(135deg,rgba(255,106,66,.16),rgba(84,146,255,.08))] text-text shadow-[inset_0_1px_rgba(255,255,255,.06)]"
                        : "border-transparent text-muted hover:border-border/80 hover:bg-bg/40 hover:text-text"
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border transition",
                        active
                          ? "border-accent/30 bg-accent/10 text-accent"
                          : "border-border/60 bg-panel/60 text-muted group-hover:border-accent2/30 group-hover:text-accent2"
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{n.label}</span>
                      <span className="block text-[11px] text-muted/80">
                        {n.id === "dashboard" && "Overview and weekly signal"}
                        {n.id === "events" && "Likes, watches, subscriptions"}
                        {n.id === "downloads" && "Queue, progress, Telegram delivery"}
                        {n.id === "logs" && "Structured service traces"}
                        {n.id === "settings" && "Credentials and runtime tuning"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-4 grid gap-3 lg:mt-auto">
            <div className="rounded-[24px] border border-border/70 bg-bg/40 p-4">
              <div className="mb-3 text-[10px] uppercase tracking-[0.28em] text-muted/80">Service mesh</div>
              <ServiceHealthDot />
            </div>
            <div className="rounded-[24px] border border-border/70 bg-bg/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.28em] text-muted/80">Operator</div>
                  <div className="mt-2 text-lg font-medium text-text">{user.username}</div>
                  <div className="text-sm text-muted">Signed in and following live telemetry.</div>
                </div>
                <button
                  onClick={async () => { await apiPost("auth/logout"); onLogout(); }}
                  className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full border border-border/70 bg-panel/60 text-muted transition hover:border-accent/30 hover:text-text"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <main className="relative min-w-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.04] to-transparent" />
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
