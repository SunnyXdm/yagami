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
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b lg:border-b-0 lg:border-r border-border bg-panel/70 lg:bg-panel/40 backdrop-blur flex flex-col lg:h-screen lg:sticky lg:top-0">
        <div className="px-4 lg:px-5 py-4 lg:py-5 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-sm font-semibold">Yagami</div>
            <div className="text-[11px] text-muted">control center</div>
          </div>
        </div>
        <nav className="flex lg:block lg:flex-1 gap-1 px-3 pb-3 lg:pb-0 lg:space-y-1 overflow-x-auto">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => onPage(n.id)}
                className={cn(
                  "flex lg:w-full items-center justify-center lg:justify-start gap-2 lg:gap-3 px-3 py-2 text-sm rounded-lg transition whitespace-nowrap",
                  active
                    ? "bg-bg text-text shadow-inner ring-1 ring-border"
                    : "text-muted hover:text-text hover:bg-bg/60"
                )}
              >
                <Icon size={16} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="hidden lg:block p-3 mt-auto">
          <ServiceHealthDot />
          <div className="mt-3 flex items-center justify-between bg-bg/60 border border-border rounded-lg px-3 py-2">
            <div className="text-xs">
              <div className="text-text">{user.username}</div>
              <div className="text-muted">signed in</div>
            </div>
            <button
              onClick={async () => { await apiPost("auth/logout"); onLogout(); }}
              className="text-muted hover:text-text"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
