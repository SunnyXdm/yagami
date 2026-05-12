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
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
        <div className="page-container flex min-h-[72px] items-center gap-4">
          <button onClick={() => onPage("dashboard")} className="flex flex-shrink-0 items-center gap-3 text-left">
            <Logo className="h-4 w-4" />
            <div>
              <div className="mono-caps">Editorial control</div>
              <div className="font-display text-[30px] leading-none tracking-[-0.04em] text-text">Yagami</div>
            </div>
          </button>

          <nav className="mx-auto hidden min-[960px]:flex items-center gap-6">
            {nav.map((item) => (
              <NavButton key={item.id} item={item} active={page === item.id} onSelect={onPage} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden xl:block text-right">
              <div className="mono-caps">Operator</div>
              <div className="text-sm text-ash">{user.username}</div>
            </div>
            <button
              onClick={async () => { await apiPost("auth/logout"); onLogout(); }}
              className="button-secondary-dark gap-2"
              title="Sign out"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>

        <div className="border-t border-border min-[960px]:hidden">
          <div className="page-container flex gap-3 overflow-x-auto py-3">
            {nav.map((item) => (
              <NavButton key={item.id} item={item} active={page === item.id} onSelect={onPage} mobile />
            ))}
          </div>
        </div>

        <div className="border-t border-border/80">
          <div className="page-container flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="mono-caps">Runtime mesh</div>
            <ServiceHealthDot />
          </div>
        </div>
      </header>

      <main className="page-container py-8 md:py-10 lg:py-12">{children}</main>
    </div>
  );
}

function NavButton({
  item,
  active,
  onSelect,
  mobile = false,
}: {
  item: { id: Page; label: string; icon: any };
  active: boolean;
  onSelect: (page: Page) => void;
  mobile?: boolean;
}) {
  const Icon = item.icon;

  if (mobile) {
    return (
      <button
        onClick={() => onSelect(item.id)}
        className={cn(
          "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-[13px] font-medium transition",
          active
            ? "border-hairline bg-light text-ink"
            : "border-border bg-panel text-ash hover:text-text"
        )}
      >
        <Icon size={14} className={active ? "text-ink" : "text-muted"} />
        {item.label}
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(item.id)}
      className={cn(
        "group relative flex items-center gap-2 py-3 text-[16px] transition",
        active ? "text-text" : "text-ash hover:text-text"
      )}
    >
      <Icon size={15} className={active ? "text-accent" : "text-muted group-hover:text-text"} />
      <span>{item.label}</span>
      <span
        className={cn(
          "absolute inset-x-0 -bottom-px h-px bg-text transition-opacity",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
        )}
      />
    </button>
  );
}
