import { useState } from "react";
import {
  Activity, Settings, Terminal, Download, LogOut, Heart, Menu, X,
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
        <div className="page-container flex min-h-[64px] items-center gap-3 py-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="button-secondary-dark h-9 w-9 px-0 md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>

          <button onClick={() => onPage("dashboard")} className="flex flex-shrink-0 items-center gap-3 text-left">
            <Logo className="h-9 w-9" />
            <div>
              <div className="text-[13px] font-medium leading-none text-body">Command center</div>
              <div className="mt-1 text-[18px] font-semibold tracking-[0.01em] text-text">Yagami</div>
            </div>
          </button>

          <nav className="mx-auto hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <NavButton key={item.id} item={item} active={page === item.id} onSelect={onPage} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden rounded-[8px] border border-border bg-panel px-3 py-2 text-[13px] text-body xl:flex">
              {user.username}
            </div>
            <button
              onClick={async () => { await apiPost("auth/logout"); onLogout(); }}
              className="hidden button-secondary-dark gap-2 sm:inline-flex"
              title="Sign out"
            >
              <LogOut size={14} />
              Sign out
            </button>
            <button type="button" onClick={() => onPage("downloads")} className="button-primary-dark gap-2">
              <Download size={14} />
              Open queue
            </button>
          </div>
        </div>

        <div className="border-t border-border/80">
          <div className="page-container flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-[13px] text-body">
              <span className="keycap">⌘</span>
              <span className="keycap">K</span>
              <span>Search commands, queues, settings, and activity</span>
            </div>
            <ServiceHealthDot />
          </div>
        </div>
      </header>

      <main className="page-container py-8 md:py-10 lg:py-12">{children}</main>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMobileNavOpen(false)}>
          <aside
            className="h-full w-[88vw] max-w-sm border-r border-border bg-bg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <Logo className="h-9 w-9" />
                <div>
                  <div className="text-[13px] font-medium text-body">Command center</div>
                  <div className="text-[18px] font-semibold text-text">Yagami</div>
                </div>
              </div>
              <button type="button" onClick={() => setMobileNavOpen(false)} className="button-secondary-dark h-9 w-9 px-0" aria-label="Close navigation">
                <X size={16} />
              </button>
            </div>

            <nav className="mt-4 space-y-2">
              {nav.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={page === item.id}
                  onSelect={(next) => {
                    setMobileNavOpen(false);
                    onPage(next);
                  }}
                  mobile
                />
              ))}
            </nav>

            <div className="mt-6 space-y-3 border-t border-border pt-4">
              <div className="text-[13px] text-body">Signed in as {user.username}</div>
              <button
                type="button"
                onClick={async () => {
                  await apiPost("auth/logout");
                  onLogout();
                }}
                className="button-secondary-dark w-full gap-2"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
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
          "flex w-full items-center gap-3 rounded-[10px] border px-4 py-3 text-left text-[14px] transition",
          active
            ? "border-white/12 bg-elevated text-text"
            : "border-border bg-panel text-body"
        )}
      >
        <span className={cn(
          "grid h-8 w-8 place-items-center rounded-[8px] border border-border bg-card",
          active ? "text-text" : "text-body"
        )}>
          <Icon size={14} />
        </span>
        <span>{item.label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(item.id)}
      className={cn(
        "group inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[14px] transition",
        active ? "border-white/12 bg-elevated text-text" : "border-transparent text-body hover:border-border hover:bg-panel hover:text-text"
      )}
    >
      <span className={cn(
        "grid h-7 w-7 place-items-center rounded-[6px] border border-border bg-card",
        active ? "text-text" : "text-body group-hover:text-text"
      )}>
        <Icon size={14} />
      </span>
      <span>{item.label}</span>
    </button>
  );
}
